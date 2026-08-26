import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import * as vscode from 'vscode';
import {
	codeToEnglishSchema,
	lineCount,
	MAX_ENGLISH_BYTES,
	MAX_SOURCE_BYTES,
	MAX_SOURCE_LINES,
	numberedSource,
	type InterpretationResult,
	validateInterpretation,
} from './interpretation';
import {
	resolveCodexModel,
	visibleCodexModels,
	type CodexModel,
	type CodexModelPreference,
} from './modelSelection';
import { isRecord } from './typeGuards';

const MINIMUM_CODEX_VERSION = '0.148.0-alpha.15';
const MAX_PROTOCOL_LINE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const TURN_TIMEOUT_MS = 180_000;
const MAX_NOTIFICATIONS = 10_000;
const supportedVersionChecks = new Map<string, Promise<void>>();
const DISABLED_CODEX_FEATURES = [
	'apps',
	'browser_use',
	'computer_use',
	'image_generation',
	'in_app_browser',
	'multi_agent',
	'plugins',
	'remote_plugin',
	'shell_tool',
	'skill_search',
	'tool_suggest',
	'unified_exec',
	'view_image',
	'workspace_dependencies',
] as const;
const FORBIDDEN_TOOL_ITEM_TYPES = new Set([
	'collabAgentToolCall',
	'commandExecution',
	'dynamicToolCall',
	'fileChange',
	'imageGeneration',
	'imageView',
	'mcpToolCall',
	'sleep',
	'subAgentActivity',
	'toolSearch',
	'webSearch',
]);

export const englishToCodeSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['proposedSource', 'summary'],
	properties: {
		proposedSource: { type: 'string' },
		summary: { type: 'string' },
	},
} as const;

interface RpcNotification {
	method: string;
	params?: Record<string, unknown>;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

interface NotificationWaiter {
	predicate: (notification: RpcNotification) => boolean;
	resolve: (notification: RpcNotification) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
}

export interface CodeToEnglishInput {
	source: string;
	sourcePath: string;
	languageId: string;
	workspacePath: string;
	cancellationToken: vscode.CancellationToken;
	onRetry?: (message: string) => void;
	modelPreference?: CodexModelPreference;
}

export interface ModelResolution {
	model: string;
	unavailableModelId?: string;
	modelEnumerationFailed?: boolean;
}

export interface CodeToEnglishOutput extends ModelResolution {
	document: InterpretationResult;
}

export interface EnglishToCodeInput {
	source: string;
	english: string;
	sourcePath: string;
	languageId: string;
	workspacePath: string;
	cancellationToken: vscode.CancellationToken;
	onRetry?: (message: string) => void;
	modelPreference?: CodexModelPreference;
}

export interface CodeChangeResult {
	proposedSource: string;
	summary: string;
}

export interface EnglishToCodeOutput extends CodeChangeResult, ModelResolution {}

export class CodexResponseError extends Error {
	constructor(message: string, readonly willRetry = false) {
		super(message);
	}
}
export class AuthenticationRequiredError extends CodexResponseError {}
export class UsageLimitedError extends CodexResponseError {}

export class CodexInterpreter {
	async listModels(_workspacePath: string): Promise<CodexModel[]> {
		const executable = resolveCodexExecutable();
		await assertSupportedVersion(executable);
		const client = new AppServerClient(executable);
		try {
			await client.start();
			await assertChatGPTAccount(client);
			const models = await readVisibleModels(client);
			if (models.length === 0) {
				throw new Error('Codex returned no available models.');
			}
			return models;
		} finally {
			await client.stop();
		}
	}

	async codeToEnglish(input: CodeToEnglishInput): Promise<CodeToEnglishOutput> {
		assertBoundedSource(input.source);
		const sourceLineCount = lineCount(input.source);
		const output = await this.runStructuredTurn({
			prompt: buildCodeToEnglishPrompt(input.source, input.sourcePath, input.languageId),
			schema: codeToEnglishSchema(sourceLineCount),
			preferMedium: true,
			cancellationToken: input.cancellationToken,
			onRetry: input.onRetry,
			modelPreference: input.modelPreference,
		});
		return {
			document: validateInterpretation(output.parsed, input.source),
			model: output.model,
			...(output.unavailableModelId ? { unavailableModelId: output.unavailableModelId } : {}),
			...(output.modelEnumerationFailed ? { modelEnumerationFailed: true } : {}),
		};
	}

	async englishToCode(input: EnglishToCodeInput): Promise<EnglishToCodeOutput> {
		assertBoundedSource(input.source);
		if (Buffer.byteLength(input.english, 'utf8') > MAX_ENGLISH_BYTES) {
			throw new Error('The English document exceeds the LangClarity MVP limit of 256 KiB.');
		}
		const output = await this.runStructuredTurn({
			prompt: buildEnglishToCodePrompt(input),
			schema: englishToCodeSchema,
			preferMedium: false,
			cancellationToken: input.cancellationToken,
			onRetry: input.onRetry,
			modelPreference: input.modelPreference,
		});
		return {
			...validateCodeChangeResult(output.parsed),
			model: output.model,
			...(output.unavailableModelId ? { unavailableModelId: output.unavailableModelId } : {}),
			...(output.modelEnumerationFailed ? { modelEnumerationFailed: true } : {}),
		};
	}

	private async runStructuredTurn(input: {
		prompt: string;
		schema: unknown;
		preferMedium: boolean;
		cancellationToken: vscode.CancellationToken;
		onRetry?: (message: string) => void;
		modelPreference?: CodexModelPreference;
	}): Promise<{ parsed: unknown } & ModelResolution> {
		const executable = resolveCodexExecutable();
		await assertSupportedVersion(executable);
		const client = new AppServerClient(executable);

		try {
			await client.start();
			await assertChatGPTAccount(client);
			let models: CodexModel[] = [];
			let modelEnumerationFailed = false;
			try {
				models = await readVisibleModels(client);
				modelEnumerationFailed = models.length === 0;
			} catch {
				modelEnumerationFailed = true;
			}
			const resolved = models.length > 0
				? resolveCodexModel(models, input.modelPreference ?? {}, input.preferMedium)
				: undefined;
			const thread = await client.request('thread/start', {
				...(resolved ? { model: resolved.model.id } : {}),
				allowProviderModelFallback: false,
				...toolRestrictedThreadPolicy(client.runtimeRoot),
				approvalPolicy: 'never',
				sandbox: 'read-only',
				baseInstructions: 'Do not invoke tools or modify files. Return only the structured final answer requested by the user.',
				ephemeral: true,
				historyMode: 'paginated',
				environments: [],
				dynamicTools: [],
			}) as { thread?: { id?: string }; model?: string };
			if (!thread.thread?.id || typeof thread.model !== 'string' || thread.model.length === 0) {
				throw new Error('Codex returned an invalid thread response.');
			}

			const response = await client.runTurn({
				threadId: thread.thread.id,
				prompt: input.prompt,
				schema: input.schema,
				model: thread.model,
				effort: resolved?.reasoningEffort,
				cancellationToken: input.cancellationToken,
				onRetry: input.onRetry,
			});
			let parsed: unknown;
			try {
				parsed = JSON.parse(response);
			} catch {
				throw new Error('Codex returned malformed structured output.');
			}
			return {
				parsed,
				model: thread.model,
				...(resolved?.unavailableModelId
					? { unavailableModelId: resolved.unavailableModelId }
					: {}),
				...(modelEnumerationFailed ? { modelEnumerationFailed: true } : {}),
			};
		} catch (error) {
			if (input.cancellationToken.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			throw error;
		} finally {
			await client.stop();
		}
	}
}

async function assertChatGPTAccount(client: AppServerClient): Promise<void> {
	const account = await client.request('account/read', { refreshToken: false }) as {
		account?: { type?: string } | null;
	};
	if (account.account?.type !== 'chatgpt') {
		throw new AuthenticationRequiredError('Sign in to Codex with ChatGPT, then try again.');
	}
}

async function readVisibleModels(client: AppServerClient): Promise<CodexModel[]> {
	return visibleCodexModels(await client.request('model/list', {
		limit: 100,
		includeHidden: false,
	}));
}

function assertBoundedSource(source: string): void {
	if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES || lineCount(source) > MAX_SOURCE_LINES) {
		throw new Error('The current source exceeds the LangClarity MVP limit of 75 KiB or 2,000 lines.');
	}
}

function buildCodeToEnglishPrompt(source: string, sourcePath: string, languageId: string): string {
	const sourceLineCount = lineCount(source);
	return [
		`Interpret ${sourcePath} (${languageId}) as English that an everyday person can understand as easily as possible.`,
		`Return exactly ${sourceLineCount} behavior items: one item for every numbered source line, in the same order.`,
		'For item 1 use sourceLine 1, for item 2 use sourceLine 2, and continue without gaps, duplicates, combining lines, or reordering.',
		'Write each statement as the everyday meaning of only that source line. Use an empty statement for a blank source line.',
		'Lead with plain meaning. Mention a code identifier afterward only when it is needed for exact correspondence or later reference.',
		'Use the shortest clear wording. Prefer one clause and about 12 to 18 words, excluding any literal value that must be preserved.',
		'Let an opening or parent row establish context for the indented rows beneath it. Do not repeat a subject, identifier, type, or explanation when that context remains unambiguous.',
		'Readable fragments are allowed when they are clearer and shorter, such as "Message 1: \"Hello.\"" or "Remember this choice."',
		'For syntax-only closing lines, use a minimal phrase such as "End the function." or "End the list."',
		'Preserve every visible string, number, boolean, property name, event name, URL, log label, and other known value verbatim in that line\'s statement.',
		'When a value can be worked out from fixed source values, state the everyday result and retain the underlying rule when it matters. For example, say "Choose a whole number from 0 through 16 to select one of the 17 messages."',
		'Avoid unexplained technical terms such as array, index, mutation, boolean, callback, instance, or expression. If one is unavoidable, explain it in the same sentence.',
		'Use familiar phrases such as "Create...", "Remember...", "If..., then...", "For each...", "Keep doing this until...", and "Give back..." when they fit.',
		'Do not use uppercase pseudocode keywords, assignment arrows, symbolic operators, or programming-language syntax as sentence structure.',
		'Use two-space indentation inside statements to show that a source line belongs inside a function, condition, loop, or other enclosing action.',
		'Avoid narrative filler, repeated context, vague summaries such as "the listed strings" or "the configured value", mechanical syntax transcription, and behavior not present in the source.',
		'Make only claims supported by the numbered source and omit uncertain claims.',
		'Distinguish mutation of inputs from mutation of copied or temporary values.',
		'Check behavior, side effects, and constraints for contradictions.',
		'Do not use tools. Return only JSON matching the supplied schema.',
		'',
		numberedSource(source),
	].join('\n');
}

function buildEnglishToCodePrompt(input: EnglishToCodeInput): string {
	return [
		`Update ${input.sourcePath} (${input.languageId}) so the current source matches the edited English.`,
		'Return the complete proposed source document, not a patch.',
		'Make the smallest practical change and preserve all unrelated code, formatting, comments, and identifiers.',
		'Do not use tools or write files. Return only JSON matching the supplied schema.',
		'',
		'CURRENT SOURCE:',
		input.source,
		'',
		'EDITED ENGLISH:',
		input.english,
	].join('\n');
}

export function validateCodeChangeResult(value: unknown): CodeChangeResult {
	if (!isRecord(value)
		|| Object.keys(value).length !== 2
		|| typeof value.proposedSource !== 'string'
		|| value.proposedSource.length === 0
		|| Buffer.byteLength(value.proposedSource, 'utf8') > MAX_SOURCE_BYTES
		|| lineCount(value.proposedSource) > MAX_SOURCE_LINES
		|| typeof value.summary !== 'string'
		|| value.summary.trim().length === 0
		|| value.summary.length > 1_000
		|| /[\r\n]/u.test(value.summary)
		|| !Object.hasOwn(value, 'proposedSource')
		|| !Object.hasOwn(value, 'summary')) {
		throw new Error('Codex returned an invalid code proposal.');
	}
	return { proposedSource: value.proposedSource, summary: value.summary };
}

export function codexErrorFrom(value: unknown, willRetry = false): CodexResponseError {
	const error = isRecord(value) ? value : undefined;
	const message = typeof error?.message === 'string' && error.message.length > 0
		? error.message
		: 'Codex returned an unknown error.';
	if (error?.codexErrorInfo === 'usageLimitExceeded') {
		return new UsageLimitedError(message, willRetry);
	}
	if (error?.codexErrorInfo === 'unauthorized') {
		return new AuthenticationRequiredError(message, willRetry);
	}
	return new CodexResponseError(message, willRetry);
}

export function toolRestrictedAppServerArgs(): string[] {
	return [
		'app-server',
		'--stdio',
		'-c',
		'web_search="disabled"',
		'-c',
		'mcp_servers={}',
		'-c',
		'apps={}',
		...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]),
	];
}

export function toolRestrictedThreadPolicy(runtimeRoot: string): Record<string, unknown> {
	return {
		cwd: runtimeRoot,
		runtimeWorkspaceRoots: [runtimeRoot],
		config: {
			web_search: 'disabled',
			mcp_servers: {},
			apps: {},
			features: Object.fromEntries(DISABLED_CODEX_FEATURES.map((feature) => [feature, false])),
		},
	};
}

export function isForbiddenToolNotification(notification: RpcNotification): boolean {
	if (notification.method !== 'item/started' && notification.method !== 'item/completed') {
		return false;
	}
	const item = notification.params?.item;
	return isRecord(item) && typeof item.type === 'string' && FORBIDDEN_TOOL_ITEM_TYPES.has(item.type);
}

function resolveCodexExecutable(): string {
	const bundledMacExecutable = '/Applications/ChatGPT.app/Contents/Resources/codex';
	return process.platform === 'darwin' && existsSync(bundledMacExecutable)
		? bundledMacExecutable
		: 'codex';
}

function assertSupportedVersion(executable: string): Promise<void> {
	const existing = supportedVersionChecks.get(executable);
	if (existing) {
		return existing;
	}
	const check = checkSupportedVersion(executable);
	supportedVersionChecks.set(executable, check);
	void check.catch(() => {
		if (supportedVersionChecks.get(executable) === check) {
			supportedVersionChecks.delete(executable);
		}
	});
	return check;
}

async function checkSupportedVersion(executable: string): Promise<void> {
	const versionOutput = await runProcess(executable, ['--version']);
	const version = versionOutput.match(/\d+\.\d+\.\d+(?:-[\w.]+)?/u)?.[0];
	if (!version) {
		throw new Error('Codex is not installed or did not report a version.');
	}
	if (compareVersions(version, MINIMUM_CODEX_VERSION) < 0) {
		throw new Error(`LangClarity requires Codex ${MINIMUM_CODEX_VERSION} or newer. Found ${version}.`);
	}
}

function runProcess(executable: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.once('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				reject(new Error('Codex is not installed. Install or update Codex, then try again.'));
				return;
			}
			reject(error);
		});
		child.once('exit', (code) => {
			if (code === 0) {
				resolve(output);
			} else {
				reject(new Error('Codex could not be started.'));
			}
		});
	});
}

export function compareVersions(left: string, right: string): number {
	const leftVersion = parseVersion(left);
	const rightVersion = parseVersion(right);
	for (let index = 0; index < 3; index += 1) {
		const difference = leftVersion.core[index] - rightVersion.core[index];
		if (difference !== 0) {
			return Math.sign(difference);
		}
	}
	if (!leftVersion.prerelease && !rightVersion.prerelease) {
		return 0;
	}
	if (!leftVersion.prerelease) {
		return 1;
	}
	if (!rightVersion.prerelease) {
		return -1;
	}
	const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = leftVersion.prerelease[index];
		const rightPart = rightVersion.prerelease[index];
		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		const leftNumber = Number(leftPart);
		const rightNumber = Number(rightPart);
		const difference = Number.isNaN(leftNumber) || Number.isNaN(rightNumber)
			? leftPart.localeCompare(rightPart)
			: leftNumber - rightNumber;
		if (difference !== 0) {
			return Math.sign(difference);
		}
	}
	return 0;
}

function parseVersion(value: string): { core: [number, number, number]; prerelease?: string[] } {
	const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/u);
	if (!match) {
		return { core: [0, 0, 0], prerelease: [value] };
	}
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		...(match[4] ? { prerelease: match[4].split('.') } : {}),
	};
}

class AppServerClient {
	private process: ChildProcessWithoutNullStreams | undefined;
	private isolatedRuntimeRoot: string | undefined;
	private stopping = false;
	private nextId = 1;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly notifications: RpcNotification[] = [];
	private readonly waiters: NotificationWaiter[] = [];
	private readonly notificationListeners = new Set<(notification: RpcNotification) => void>();

	constructor(private readonly executable: string) {}

	get runtimeRoot(): string {
		if (!this.isolatedRuntimeRoot) {
			throw new Error('Codex app server has not started.');
		}
		return this.isolatedRuntimeRoot;
	}

	async start(): Promise<void> {
		this.isolatedRuntimeRoot = await mkdtemp(path.join(tmpdir(), 'langclarity-codex-'));
		this.process = spawn(this.executable, toolRestrictedAppServerArgs(), {
			cwd: this.isolatedRuntimeRoot,
			shell: false,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		this.process.once('error', (error) => this.rejectAll(error));
		this.process.once('exit', () => {
			if (!this.stopping) {
				this.rejectAll(new Error('Codex app server exited unexpectedly.'));
			}
		});
		createInterface({ input: this.process.stdout }).on('line', (line) => this.onLine(line));
		createInterface({ input: this.process.stderr }).on('line', () => {
			// Intentionally redact process diagnostics; the extension logs only error categories.
		});
		await this.request('initialize', {
			clientInfo: { name: 'langclarity', title: 'LangClarity', version: '0.0.1' },
			capabilities: {
				experimentalApi: true,
				requestAttestation: false,
				optOutNotificationMethods: [],
			},
		});
		this.send({ method: 'initialized' });
	}

	request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out.`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.send({ method, id, params });
			} catch (error) {
				clearTimeout(timer);
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error('Codex request could not be sent.'));
			}
		});
	}

	async runTurn(input: {
		threadId: string;
		prompt: string;
		schema: unknown;
		model: string;
		effort?: string;
		cancellationToken: vscode.CancellationToken;
		onRetry?: (message: string) => void;
	}): Promise<string> {
		let turnId: string | undefined;
		const retryListener = (notification: RpcNotification): void => {
			const params = notification.params;
			if (!params
				|| notification.method !== 'error'
				|| params.turnId !== turnId
				|| params.willRetry !== true) {
				return;
			}
			const error = params.error;
			if (isRecord(error) && typeof error.message === 'string' && error.message.length > 0) {
				input.onRetry?.(error.message);
			}
		};
		const cancellation = input.cancellationToken.onCancellationRequested(() => {
			if (turnId) {
				void this.request('turn/interrupt', { threadId: input.threadId, turnId }).catch(() => undefined);
			} else {
				void this.stop(new vscode.CancellationError());
			}
		});

		try {
			if (input.cancellationToken.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			const started = await this.request('turn/start', {
				threadId: input.threadId,
				input: [{ type: 'text', text: input.prompt, text_elements: [] }],
				environments: [],
				model: input.model,
				...(input.effort ? { effort: input.effort } : {}),
				outputSchema: input.schema,
			}) as { turn?: { id?: string } };
			turnId = started.turn?.id;
			if (!turnId) {
				throw new Error('Codex returned an invalid turn response.');
			}
			this.notificationListeners.add(retryListener);
			if (input.cancellationToken.isCancellationRequested) {
				await this.request('turn/interrupt', { threadId: input.threadId, turnId }).catch(() => undefined);
			}

			const completed = await this.waitFor(
				(notification) => notification.method === 'turn/completed'
					&& turnIdFrom(notification) === turnId,
				TURN_TIMEOUT_MS,
			);
			const turn = completed.params?.turn as { status?: string; error?: unknown } | undefined;
			if (turn?.status === 'interrupted' || input.cancellationToken.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			if (turn?.status !== 'completed') {
				const errorNotification = [...this.notifications].reverse().find(
					(notification) => notification.method === 'error'
						&& notification.params?.turnId === turnId,
				);
				throw codexErrorFrom(
					turn?.error ?? errorNotification?.params?.error,
					errorNotification?.params?.willRetry === true,
				);
			}
			const response = latestAgentMessage(this.notifications, turnId);
			if (!response) {
				throw new Error('Codex completed without a structured result.');
			}
			if (Buffer.byteLength(response, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
				throw new Error('Codex returned a structured result larger than 2 MiB.');
			}
			return response;
		} finally {
			this.notificationListeners.delete(retryListener);
			cancellation.dispose();
		}
	}

	async stop(reason?: Error): Promise<void> {
		this.stopping = true;
		if (reason) {
			this.rejectAll(reason);
		}
		const child = this.process;
		if (!child || child.exitCode !== null || child.killed) {
			await this.removeRuntimeRoot();
			return;
		}
		child.stdin.end();
		const exited = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 2_000);
			child.once('exit', () => {
				clearTimeout(timer);
				resolve(true);
			});
		});
		if (!exited && child.exitCode === null) {
			child.kill('SIGTERM');
		}
		await this.removeRuntimeRoot();
	}

	private abort(error: Error): void {
		this.stopping = true;
		this.rejectAll(error);
		this.process?.kill('SIGTERM');
		void this.removeRuntimeRoot();
	}

	private async removeRuntimeRoot(): Promise<void> {
		const runtimeRoot = this.isolatedRuntimeRoot;
		this.isolatedRuntimeRoot = undefined;
		if (runtimeRoot) {
			await rm(runtimeRoot, { recursive: true, force: true });
		}
	}

	private send(message: unknown): void {
		if (!this.process || this.process.stdin.destroyed) {
			throw new Error('Codex app server is not running.');
		}
		this.process.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private onLine(line: string): void {
		if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE_BYTES) {
			this.rejectAll(new Error('Codex returned a protocol message larger than 2 MiB.'));
			void this.stop();
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(line) as Record<string, unknown>;
		} catch {
			this.rejectAll(new Error('Codex returned malformed protocol data.'));
			void this.stop();
			return;
		}

		if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (isRpcError(message.error)) {
				pending.reject(new CodexResponseError(message.error.message));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		if (typeof message.id === 'number' && typeof message.method === 'string') {
			this.send({
				id: message.id,
				error: { code: -32601, message: `LangClarity does not permit server request: ${message.method}` },
			});
			return;
		}

		if (typeof message.method === 'string') {
			const notification: RpcNotification = {
				method: message.method,
				params: isRecord(message.params) ? message.params : undefined,
			};
			if (isForbiddenToolNotification(notification)) {
				this.abort(new Error('Codex attempted to invoke a tool in a tool-restricted session.'));
				return;
			}
			if (this.notifications.length >= MAX_NOTIFICATIONS) {
				this.rejectAll(new Error('Codex returned too many protocol notifications.'));
				void this.stop();
				return;
			}
			this.notifications.push(notification);
			for (const listener of this.notificationListeners) {
				listener(notification);
			}
			for (const waiter of [...this.waiters]) {
				if (waiter.predicate(notification)) {
					this.waiters.splice(this.waiters.indexOf(waiter), 1);
					clearTimeout(waiter.timer);
					waiter.resolve(notification);
				}
			}
		}
	}

	private waitFor(
		predicate: (notification: RpcNotification) => boolean,
		timeoutMs: number,
	): Promise<RpcNotification> {
		const existing = this.notifications.find(predicate);
		if (existing) {
			return Promise.resolve(existing);
		}
		return new Promise((resolve, reject) => {
			const waiter: NotificationWaiter = {
				predicate,
				resolve,
				reject,
				timer: setTimeout(() => {
					this.waiters.splice(this.waiters.indexOf(waiter), 1);
					reject(new Error('Codex interpretation timed out after three minutes.'));
				}, timeoutMs),
			};
			this.waiters.push(waiter);
		});
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
		for (const waiter of this.waiters) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
		this.waiters.length = 0;
	}
}

function isRpcError(value: unknown): value is { message: string } {
	return isRecord(value) && typeof value.message === 'string' && value.message.length > 0;
}

function turnIdFrom(notification: RpcNotification): string | undefined {
	const turn = notification.params?.turn;
	return isRecord(turn) && typeof turn.id === 'string' ? turn.id : undefined;
}

function latestAgentMessage(notifications: RpcNotification[], turnId: string): string | undefined {
	for (let index = notifications.length - 1; index >= 0; index -= 1) {
		const notification = notifications[index];
		if (notification.method !== 'item/completed' || notification.params?.turnId !== turnId) {
			continue;
		}
		const item = notification.params.item;
		if (isRecord(item) && item.type === 'agentMessage' && typeof item.text === 'string') {
			return item.text;
		}
	}
	return undefined;
}
