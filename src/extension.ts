import path from 'node:path';
import * as vscode from 'vscode';
import {
	CodexInterpreter,
	type CodeToEnglishOutput,
	type ModelResolution,
} from './codexInterpreter';
import {
	parseEnglishDocument,
} from './englishDocument';
import { appendLangClarityIgnoreRule, hasLangClarityIgnoreRule } from './gitignore';
import type { Interpreter } from './interpreter';
import {
	InterpretationViewProvider,
	interpretationViewType,
} from './interpretationViewProvider';
import {
	englishUriFor,
	hashText,
	MAX_ENGLISH_BYTES,
	relativeSourcePath,
	renderInterpretation,
	sourceAccessError,
	sourceEligibilityError,
} from './interpretation';
import {
	replaceTextDocumentAndSave,
	assertPathHasNoSymlinks,
	uriExists,
	writeNewFileAtomically,
} from './markdownRepository';
import {
	codexRetryReporter,
	ensureEnglishWithinLimits,
	ensureSourceWithinLimits,
	reportOperationFailure,
	requireTrustedWorkspace,
	runModelCommand,
	withCodexProgress,
} from './modelCommands';
import { PairedFileLifecycle } from './pairedFileLifecycle';
import { ProposalCoordinator } from './proposalCoordinator';
import { SessionCoordinator } from './sessionCoordinator';
import type { CodexModel, CodexModelPreference } from './modelSelection';
import { repositoryFactsFor } from './repositoryFacts';

const disclosureKey = 'langclarity.providerDisclosureAccepted.v2';
const modelPreferenceKey = 'langclarity.selectedModelId';
const reasoningPreferenceKey = 'langclarity.selectedReasoningEffort';
const gitignoreChoicesKey = 'langclarity.gitignoreChoices.v1';
type GitignoreChoice = 'dismissed' | 'ignored' | 'trackable';
interface SyncCommandOptions {
	authorityConfirmed?: boolean;
	sourceUri?: vscode.Uri;
}

type SourceCommandInput = vscode.Uri | SyncCommandOptions | undefined;

let activeInterpreter: Interpreter | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('LangClarity');
	const codex = new CodexInterpreter();
	const interpreter: Interpreter = codex;
	activeInterpreter = interpreter;
	const pendingSources = new Set<string>();
	const sessions = new SessionCoordinator(output);
	const lifecycle = new PairedFileLifecycle(sessions, output);
	const proposals = new ProposalCoordinator(sessions, output);
	const commandVisibility = registerCommandVisibility();
	const pendingGitignorePrompts = new Set<string>();

	context.subscriptions.push(
		output,
		commandVisibility,
		sessions,
		lifecycle,
		proposals,
		vscode.window.registerCustomEditorProvider(
			interpretationViewType,
			new InterpretationViewProvider(context.extensionUri, sourceUriForEnglishDocument),
			{ webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false },
		),
		vscode.commands.registerCommand('langclarity.selectModel', async (input?: SourceCommandInput) => {
			const source = await workspaceSource(input, false);
			if (!source) {
				return;
			}
			if (!await requireTrustedWorkspace(
				'Trust this workspace before connecting to the local Codex runtime.',
			)) {
				return;
			}
			try {
				const models = await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: 'LangClarity: Loading available Codex models',
				}, () => codex.listModels(source.workspace.uri.fsPath));
				await selectModelPreference(context, models);
			} catch (error) {
				const retry = await reportOperationFailure(
					output,
					'models',
					path.posix.basename(source.document.uri.path),
					error,
					'LangClarity could not load available Codex models.',
				);
				if (retry) {
					await vscode.commands.executeCommand('langclarity.selectModel', { sourceUri: source.document.uri });
				}
			}
		}),
		vscode.commands.registerCommand('langclarity.openEnglishView', async (input?: SourceCommandInput) => {
			const source = await workspaceSource(input, false);
			if (!source) {
				return;
			}
			const englishUri = englishUriFor(source.workspace.uri, source.document.uri);
			if (await uriExists(englishUri)) {
				await openInterpretationBeside(englishUri);
				await loadSessionAndReport(sessions, source.document.uri, englishUri);
				return;
			}

			const action = await vscode.window.showInformationMessage(
				'No English interpretation exists for this file.',
				'Interpret File',
			);
			if (action === 'Interpret File') {
				await vscode.commands.executeCommand('langclarity.interpretFile', { sourceUri: source.document.uri });
			}
		}),
		vscode.commands.registerCommand('langclarity.openMarkdown', async (input?: SourceCommandInput) => {
			const source = await workspaceSource(input, false);
			if (!source) {
				return;
			}
			const englishUri = englishUriFor(source.workspace.uri, source.document.uri);
			if (!await uriExists(englishUri)) {
				await vscode.window.showInformationMessage('No English interpretation exists for this file.');
				return;
			}
			await openMarkdownBeside(englishUri);
			await loadSessionAndReport(sessions, source.document.uri, englishUri);
		}),
		vscode.commands.registerCommand('langclarity.addToGitignore', async () => {
			const workspace = await selectWorkspaceFolder();
			if (workspace) {
				await addToGitignoreAndReport(context, workspace);
			}
		}),
		vscode.commands.registerCommand('langclarity.interpretFile', async (input?: SourceCommandInput) => {
			const source = await workspaceSource(input, true);
			if (!source) {
				return;
			}
			if (!await requireTrustedWorkspace(
				'Trust this workspace before sending source to Codex/OpenAI.',
			)) {
				return;
			}

			const englishUri = englishUriFor(source.workspace.uri, source.document.uri);
			const sourceKey = source.document.uri.toString();
			if (pendingSources.has(sourceKey)) {
				await vscode.window.showInformationMessage('LangClarity is already interpreting this file.');
				return;
			}
			if (await uriExists(englishUri)) {
				const action = await vscode.window.showInformationMessage(
					'An English interpretation already exists for this file.',
					'Open Interpretation',
				);
				if (action === 'Open Interpretation') {
					await openInterpretationBeside(englishUri);
					await loadSessionAndReport(sessions, source.document.uri, englishUri);
				}
				return;
			}

			if (!await ensureProviderDisclosure(context, 'Interpret File')) {
				return;
			}

			const sourceText = source.document.getText();
			const sourceHash = hashText(sourceText);
			const sourcePath = relativeSourcePath(source.workspace.uri, source.document.uri);
			const fileName = path.posix.basename(source.document.uri.path);
			output.appendLine(`interpret:start file=${fileName}`);

			await runModelCommand({
				output,
				pendingSources,
				sourceKey,
				fileName,
				operation: 'interpret',
				cancelledMessage: 'LangClarity interpretation cancelled.',
				failureFallback: 'LangClarity could not interpret this file.',
				retryCommand: 'langclarity.interpretFile',
				retryArgs: { sourceUri: source.document.uri },
				run: async () => {
					await withCodexProgress(`LangClarity: Interpreting ${fileName}`, async (progress, cancellationToken) => {
						const interpreted = await interpreter.codeToEnglish({
							source: sourceText,
							sourcePath,
							languageId: source.document.languageId,
							workspacePath: source.workspace.uri.fsPath,
							cancellationToken,
							onRetry: codexRetryReporter(progress),
							modelPreference: currentModelPreference(context),
						});
						await reportModelResolution(context, interpreted);
						if (cancellationToken.isCancellationRequested) {
							throw new vscode.CancellationError();
						}
						if (hashText(source.document.getText()) !== sourceHash) {
							throw new Error('The source changed while Codex was interpreting it. No English file was written.');
						}
						if (source.document.isClosed) {
							throw new Error('The source was closed or moved while Codex was interpreting it. No English file was written.');
						}
						const markdown = await renderedEnglishDocument(interpreted, {
							sourcePath,
							sourceHash,
							languageId: source.document.languageId,
							source: sourceText,
							sourceUri: source.document.uri,
							workspaceUri: source.workspace.uri,
						});
						await writeNewFileAtomically(englishUri, markdown);
					});
					output.appendLine(`interpret:completed file=${fileName}`);
					await openInterpretationBeside(englishUri);
					await loadSessionAndReport(sessions, source.document.uri, englishUri);
					try {
						await offerGitignoreChoice(context, source.workspace, pendingGitignorePrompts);
					} catch {
						output.appendLine('gitignore:prompt-unavailable');
					}
				},
			});
		}),
		vscode.commands.registerCommand('langclarity.chooseSyncDirection', async (input?: SourceCommandInput) => {
			const options = syncCommandOptions(input);
			try {
				const capture = options.sourceUri
					? await captureForSourceCommand(sessions, options.sourceUri)
					: await sessions.captureActive();
				if (!capture) {
					await vscode.window.showErrorMessage('Open a LangClarity English view before choosing a synchronization direction.');
					return;
				}
				if (capture.state !== 'BOTH_CHANGED') {
					await vscode.window.showInformationMessage('Code and English are not both changed. Use the direction shown by the LangClarity status.');
					return;
				}
				const direction = await vscode.window.showWarningMessage(
					'Code and English both changed; LangClarity will not merge them. Code → English replaces unsynchronized English after a successful refresh. English → Code preserves current code until you approve its exact diff.',
					{ modal: true },
					'Code → English',
					'English → Code',
				);
				if (direction === 'Code → English') {
					await vscode.commands.executeCommand('langclarity.codeToEnglish', {
						authorityConfirmed: true,
						sourceUri: options.sourceUri,
					});
				} else if (direction === 'English → Code') {
					await vscode.commands.executeCommand('langclarity.englishToCode', {
						authorityConfirmed: true,
						sourceUri: options.sourceUri,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : 'LangClarity could not determine synchronization state.';
				await vscode.window.showErrorMessage(message);
			}
		}),
		vscode.commands.registerCommand('langclarity.englishToCode', async (input?: SourceCommandInput) => {
			const options = syncCommandOptions(input);
			const capture = options.sourceUri
				? await captureForSourceCommand(sessions, options.sourceUri)
				: await sessions.captureActive();
			if (!capture) {
				await offerMissingInterpretation(options.sourceUri, 'requesting English → Code');
				return;
			}
			const fileName = path.posix.basename(capture.sourceUri.path);
			if (capture.state === 'SYNCED') {
				await vscode.window.showInformationMessage('Edit the English document before requesting English → Code.');
				return;
			}
			if (capture.state === 'CODE_CHANGED') {
				await vscode.window.showErrorMessage('The source changed, but English did not. English → Code requires an English edit.');
				return;
			}
			if (capture.state === 'BOTH_CHANGED' && !options.authorityConfirmed) {
				const authority = await vscode.window.showWarningMessage(
					'Code and English both changed. Continuing makes English authoritative, but current code stays unchanged until you approve the exact diff.',
					{ modal: true },
					'Continue English → Code',
				);
				if (authority !== 'Continue English → Code') {
					return;
				}
			}
			if (!await requireTrustedWorkspace(
				'Trust this workspace before sending source and English to Codex/OpenAI.',
			)) {
				return;
			}
			if (!await ensureProviderDisclosure(context, 'Continue English → Code')) {
				return;
			}
			if (!await ensureSourceWithinLimits(capture.sourceText)) {
				return;
			}
			if (!await ensureEnglishWithinLimits(capture.englishText)) {
				return;
			}

			const sourceKey = capture.sourceUri.toString();

			await runModelCommand({
				output,
				pendingSources,
				sourceKey,
				fileName,
				operation: 'proposal',
				cancelledMessage: 'LangClarity proposal cancelled.',
				failureFallback: 'LangClarity could not create a code proposal.',
				retryCommand: 'langclarity.englishToCode',
				retryArgs: { sourceUri: capture.sourceUri },
				run: async () => {
					const workspace = vscode.workspace.getWorkspaceFolder(capture.sourceUri);
					if (!workspace) {
						throw new Error('The paired source is no longer inside a workspace.');
					}
					output.appendLine(`proposal:start file=${fileName}`);
					const result = await withCodexProgress(
						`LangClarity: Proposing changes to ${fileName}`,
						async (progress, cancellationToken) => interpreter.englishToCode({
							source: capture.sourceText,
							english: capture.englishText,
							sourcePath: capture.parsedEnglish.frontmatter.source,
							languageId: capture.parsedEnglish.frontmatter.languageId,
							workspacePath: workspace.uri.fsPath,
							cancellationToken,
							onRetry: codexRetryReporter(progress),
							modelPreference: currentModelPreference(context),
						}),
					);
					await reportModelResolution(context, result);
					const current = await sessions.captureForSource(capture.sourceUri);
					if (!current
						|| current.sourceHash !== capture.sourceHash
						|| current.englishDocumentHash !== capture.englishDocumentHash) {
						throw new Error('Code or English changed while Codex was creating the proposal. Generate a new proposal.');
					}
					output.appendLine(`proposal:ready file=${fileName}`);
					await proposals.review(capture, result, async (
						proposedSource,
						cancellationToken,
						onRetry,
					) => {
						const interpreted = await interpreter.codeToEnglish({
							source: proposedSource,
							sourcePath: capture.parsedEnglish.frontmatter.source,
							languageId: capture.parsedEnglish.frontmatter.languageId,
							workspacePath: workspace.uri.fsPath,
							cancellationToken,
							onRetry,
							modelPreference: currentModelPreference(context),
						});
						await reportModelResolution(context, interpreted);
						if (cancellationToken.isCancellationRequested) {
							throw new vscode.CancellationError();
						}
						return renderedEnglishDocument(interpreted, {
							sourcePath: capture.parsedEnglish.frontmatter.source,
							sourceHash: hashText(proposedSource),
							languageId: capture.parsedEnglish.frontmatter.languageId,
							source: proposedSource,
							sourceUri: capture.sourceUri,
							workspaceUri: workspace.uri,
						});
					});
				},
			});
		}),
		vscode.commands.registerCommand('langclarity.codeToEnglish', async (input?: SourceCommandInput) => {
			const options = syncCommandOptions(input);
			const capture = options.sourceUri
				? await captureForSourceCommand(sessions, options.sourceUri)
				: await sessions.captureActive();
			if (!capture) {
				await offerMissingInterpretation(options.sourceUri, 'requesting Code → English');
				return;
			}
			const fileName = path.posix.basename(capture.sourceUri.path);
			if (capture.state === 'SYNCED') {
				await vscode.window.showInformationMessage('Code and English are already synchronized.');
				return;
			}
			if (capture.state === 'ENGLISH_CHANGED') {
				await vscode.window.showErrorMessage('English changed, but the source did not. Use English → Code to synchronize this edit.');
				return;
			}
			if (capture.state === 'BOTH_CHANGED' && !options.authorityConfirmed) {
				const authority = await vscode.window.showWarningMessage(
					'Code and English both changed. Continuing makes code authoritative and replaces the current unsynchronized English only after Codex returns a complete valid interpretation.',
					{ modal: true },
					'Continue Code → English',
				);
				if (authority !== 'Continue Code → English') {
					return;
				}
			}
			if (!await requireTrustedWorkspace(
				'Trust this workspace before sending source to Codex/OpenAI.',
			)) {
				return;
			}
			if (!await ensureProviderDisclosure(context, 'Continue Code → English')) {
				return;
			}
			if (!await ensureSourceWithinLimits(capture.sourceText)) {
				return;
			}

			const sourceKey = capture.sourceUri.toString();

			await runModelCommand({
				output,
				pendingSources,
				sourceKey,
				fileName,
				operation: 'refresh',
				cancelledMessage: 'LangClarity refresh cancelled. The previous English was preserved.',
				failureFallback: 'LangClarity could not refresh the English interpretation.',
				retryCommand: 'langclarity.codeToEnglish',
				retryArgs: { sourceUri: capture.sourceUri },
				run: async () => {
					const workspace = vscode.workspace.getWorkspaceFolder(capture.sourceUri);
					if (!workspace) {
						throw new Error('The paired source is no longer inside a workspace.');
					}
					output.appendLine(`refresh:start file=${fileName}`);
					const interpreted = await withCodexProgress(
						`LangClarity: Refreshing English for ${fileName}`,
						async (progress, cancellationToken) => interpreter.codeToEnglish({
							source: capture.sourceText,
							sourcePath: capture.parsedEnglish.frontmatter.source,
							languageId: capture.parsedEnglish.frontmatter.languageId,
							workspacePath: workspace.uri.fsPath,
							cancellationToken,
							onRetry: codexRetryReporter(progress),
							modelPreference: currentModelPreference(context),
						}),
					);
					await reportModelResolution(context, interpreted);
					const markdown = await renderedEnglishDocument(interpreted, {
						sourcePath: capture.parsedEnglish.frontmatter.source,
						sourceHash: capture.sourceHash,
						languageId: capture.parsedEnglish.frontmatter.languageId,
						source: capture.sourceText,
						sourceUri: capture.sourceUri,
						workspaceUri: workspace.uri,
					});
					const englishDocument = await vscode.workspace.openTextDocument(capture.englishUri);
					const current = await sessions.captureForSource(capture.sourceUri);
					if (!current
						|| current.sourceHash !== capture.sourceHash
						|| current.englishDocumentHash !== capture.englishDocumentHash) {
						throw new Error('Code or English changed while Codex was refreshing the interpretation. The previous English was preserved.');
					}
					await replaceTextDocumentAndSave(englishDocument, capture.englishText, markdown);
					const refreshed = await sessions.reload(capture.sourceUri);
					if (refreshed?.state !== 'SYNCED') {
						throw new Error('English was refreshed, but the synchronized baselines could not be verified.');
					}
					output.appendLine(`refresh:completed file=${fileName}`);
					await vscode.window.showInformationMessage('LangClarity refreshed the English interpretation.');
				},
			});
		}),
	);
}

async function renderedEnglishDocument(
	interpreted: CodeToEnglishOutput,
	input: {
		sourcePath: string;
		sourceHash: string;
		languageId: string;
		source: string;
		sourceUri: vscode.Uri;
		workspaceUri: vscode.Uri;
	},
): Promise<string> {
	const repositoryFacts = await repositoryFactsFor(input.source, input.sourceUri, input.workspaceUri);
	const markdown = renderInterpretation({
		result: interpreted.document,
		sourcePath: input.sourcePath,
		sourceHash: input.sourceHash,
		languageId: input.languageId,
		model: interpreted.model,
		interpretedAt: new Date().toISOString(),
		repositoryFacts,
	});
	if (Buffer.byteLength(markdown, 'utf8') > MAX_ENGLISH_BYTES) {
		throw new Error('Codex returned an English interpretation larger than the LangClarity MVP limit of 256 KiB.');
	}
	parseEnglishDocument(markdown);
	return markdown;
}

function registerCommandVisibility(): vscode.Disposable {
	let revision = 0;
	const interpretedSourcePaths: Record<string, true> = {};
	let indexBootstrapped = false;
	const deferredIndexEvents: Array<{ type: 'create' | 'delete'; uri: vscode.Uri }> = [];
	const refresh = async (): Promise<void> => {
		const currentRevision = ++revision;
		const document = vscode.window.activeTextEditor?.document;
		let hasInterpretation = false;
		if (document && !sourceAccessError(document)) {
			const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
			if (workspace) {
				try {
					if (indexBootstrapped) {
						hasInterpretation = Boolean(
							interpretedSourcePaths[document.uri.path]
							|| interpretedSourcePaths[document.uri.fsPath],
						);
					} else {
						hasInterpretation = await uriExists(englishUriFor(workspace.uri, document.uri));
					}
				} catch {
					hasInterpretation = false;
				}
			}
		}
		if (currentRevision === revision) {
			await vscode.commands.executeCommand('setContext', 'langclarity.activeHasInterpretation', hasInterpretation);
		}
	};
	const publishInterpretationIndex = async (): Promise<void> => {
		await vscode.commands.executeCommand(
			'setContext',
			'langclarity.interpretedSourcePaths',
			{ ...interpretedSourcePaths },
		);
	};
	const addEnglishToIndex = (englishUri: vscode.Uri): boolean => {
		const keys = interpretedSourceKeysFor(englishUri);
		if (!keys) {
			return false;
		}
		interpretedSourcePaths[keys.path] = true;
		interpretedSourcePaths[keys.fsPath] = true;
		return true;
	};
	const removeEnglishFromIndex = (englishUri: vscode.Uri): boolean => {
		const keys = interpretedSourceKeysFor(englishUri);
		if (!keys) {
			return false;
		}
		delete interpretedSourcePaths[keys.path];
		delete interpretedSourcePaths[keys.fsPath];
		return true;
	};
	const applyIndexEvent = (type: 'create' | 'delete', englishUri: vscode.Uri): boolean => {
		return type === 'create' ? addEnglishToIndex(englishUri) : removeEnglishFromIndex(englishUri);
	};
	const bootstrapInterpretationIndex = async (): Promise<void> => {
		for (const englishUri of await vscode.workspace.findFiles('**/.langclarity/**/*.md')) {
			addEnglishToIndex(englishUri);
		}
		indexBootstrapped = true;
		for (const event of deferredIndexEvents.splice(0)) {
			applyIndexEvent(event.type, event.uri);
		}
		await publishInterpretationIndex();
		await refresh();
	};

	const watcher = vscode.workspace.createFileSystemWatcher('**/.langclarity/**/*.md');
	const onIndexEvent = (type: 'create' | 'delete') => (englishUri: vscode.Uri): void => {
		if (!indexBootstrapped) {
			deferredIndexEvents.push({ type, uri: englishUri });
			void refresh();
			return;
		}
		if (applyIndexEvent(type, englishUri)) {
			void publishInterpretationIndex();
		}
		void refresh();
	};
	const disposables = [
		watcher,
		vscode.window.onDidChangeActiveTextEditor(() => void refresh()),
		watcher.onDidCreate(onIndexEvent('create')),
		watcher.onDidDelete(onIndexEvent('delete')),
	];
	void refresh();
	void bootstrapInterpretationIndex();
	return vscode.Disposable.from(...disposables);
}

function interpretedSourceKeysFor(englishUri: vscode.Uri): { path: string; fsPath: string } | undefined {
	const workspace = vscode.workspace.getWorkspaceFolder(englishUri);
	if (!workspace) {
		return undefined;
	}
	const relative = path.posix.relative(workspace.uri.path, englishUri.path);
	const prefix = '.langclarity/';
	if (!relative.startsWith(prefix) || !relative.endsWith('.md')) {
		return undefined;
	}
	const underLangClarity = relative.slice(prefix.length, -'.md'.length);
	const segments = underLangClarity.split('/');
	// Skip hidden trees under .langclarity (e.g. .orphaned/<uuid>/...).
	if (segments.slice(0, -1).some((segment) => segment.startsWith('.'))) {
		return undefined;
	}
	const sourceUri = vscode.Uri.joinPath(workspace.uri, underLangClarity);
	return { path: sourceUri.path, fsPath: sourceUri.fsPath };
}

async function offerGitignoreChoice(
	context: vscode.ExtensionContext,
	workspace: vscode.WorkspaceFolder,
	pendingPrompts: Set<string>,
): Promise<void> {
	const workspaceKey = workspace.uri.toString();
	if (gitignoreChoices(context)[workspaceKey] || pendingPrompts.has(workspaceKey)) {
		return;
	}
	if (hasLangClarityIgnoreRule(await currentGitignoreContent(workspace) ?? '')) {
		await setGitignoreChoice(context, workspace, 'ignored');
		return;
	}

	pendingPrompts.add(workspaceKey);
	try {
		const selected = await vscode.window.showInformationMessage(
			'LangClarity stores source-derived Markdown in .langclarity/. Should this folder be excluded from Git?',
			'Add to .gitignore',
			'Leave trackable',
		);
		if (selected === 'Add to .gitignore') {
			await addToGitignoreAndReport(context, workspace);
			return;
		}
		await setGitignoreChoice(context, workspace, selected === 'Leave trackable' ? 'trackable' : 'dismissed');
	} finally {
		pendingPrompts.delete(workspaceKey);
	}
}

async function selectWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) {
		await vscode.window.showErrorMessage('Open a workspace folder before updating .gitignore.');
		return undefined;
	}
	if (folders.length === 1) {
		return folders[0];
	}
	const selected = await vscode.window.showQuickPick(
		folders.map((workspace) => ({
			label: workspace.name,
			description: workspace.uri.fsPath,
			workspace,
		})),
		{ placeHolder: 'Choose the workspace folder whose .gitignore should be updated' },
	);
	return selected?.workspace;
}

async function addToGitignoreAndReport(
	context: vscode.ExtensionContext,
	workspace: vscode.WorkspaceFolder,
): Promise<void> {
	try {
		const result = await addLangClarityToGitignore(workspace);
		await setGitignoreChoice(context, workspace, 'ignored');
		if (result === 'pending-save') {
			await vscode.window.showInformationMessage('Added /.langclarity/ to the open .gitignore. Save it when ready.');
			return;
		}
		await vscode.window.showInformationMessage(
			result === 'already-present'
				? '.gitignore already excludes .langclarity/.'
				: 'Added /.langclarity/ to .gitignore.',
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'The .gitignore update failed.';
		await vscode.window.showErrorMessage(`LangClarity could not update .gitignore: ${message}`);
	}
}

async function addLangClarityToGitignore(
	workspace: vscode.WorkspaceFolder,
): Promise<'already-present' | 'pending-save' | 'saved'> {
	const gitignoreUri = vscode.Uri.joinPath(workspace.uri, '.gitignore');
	await assertPathHasNoSymlinks(workspace.uri, gitignoreUri);
	const existingDocument = vscode.workspace.textDocuments.find(
		(document) => document.uri.toString() === gitignoreUri.toString(),
	);
	const content = existingDocument?.getText() ?? await currentGitignoreContent(workspace);
	if (content !== undefined && hasLangClarityIgnoreRule(content)) {
		return 'already-present';
	}
	if (content === undefined) {
		await vscode.workspace.fs.writeFile(gitignoreUri, Buffer.from('/.langclarity/\n', 'utf8'));
		return 'saved';
	}

	const document = existingDocument ?? await vscode.workspace.openTextDocument(gitignoreUri);
	const endOfLine = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
	const updated = appendLangClarityIgnoreRule(document.getText(), endOfLine);
	const edit = new vscode.WorkspaceEdit();
	edit.insert(document.uri, document.positionAt(document.getText().length), updated.slice(document.getText().length));
	const wasDirty = document.isDirty;
	if (!await vscode.workspace.applyEdit(edit)) {
		throw new Error('VS Code rejected the edit.');
	}
	if (wasDirty) {
		return 'pending-save';
	}
	if (!await document.save()) {
		throw new Error('VS Code could not save the file.');
	}
	return 'saved';
}

async function currentGitignoreContent(workspace: vscode.WorkspaceFolder): Promise<string | undefined> {
	const gitignoreUri = vscode.Uri.joinPath(workspace.uri, '.gitignore');
	const openDocument = vscode.workspace.textDocuments.find(
		(document) => document.uri.toString() === gitignoreUri.toString(),
	);
	if (openDocument) {
		return openDocument.getText();
	}
	await assertPathHasNoSymlinks(workspace.uri, gitignoreUri);
	try {
		return Buffer.from(await vscode.workspace.fs.readFile(gitignoreUri)).toString('utf8');
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return undefined;
		}
		throw error;
	}
}

function gitignoreChoices(context: vscode.ExtensionContext): Record<string, GitignoreChoice> {
	return context.workspaceState.get<Record<string, GitignoreChoice>>(gitignoreChoicesKey, {});
}

async function setGitignoreChoice(
	context: vscode.ExtensionContext,
	workspace: vscode.WorkspaceFolder,
	choice: GitignoreChoice,
): Promise<void> {
	await context.workspaceState.update(gitignoreChoicesKey, {
		...gitignoreChoices(context),
		[workspace.uri.toString()]: choice,
	});
}

async function workspaceSource(input: SourceCommandInput, enforceGenerationLimits: boolean): Promise<{
	document: vscode.TextDocument;
	workspace: vscode.WorkspaceFolder;
} | undefined> {
	const requestedUri = sourceUriFrom(input);
	const document = requestedUri
		? await vscode.workspace.openTextDocument(requestedUri)
		: vscode.window.activeTextEditor?.document;
	if (!document) {
		void vscode.window.showErrorMessage('Open a TypeScript or JavaScript file first.');
		return undefined;
	}
	const eligibilityError = enforceGenerationLimits
		? sourceEligibilityError(document)
		: sourceAccessError(document);
	if (eligibilityError) {
		void vscode.window.showErrorMessage(eligibilityError);
		return undefined;
	}
	const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspace) {
		void vscode.window.showErrorMessage('LangClarity requires a saved file inside the current workspace.');
		return undefined;
	}
	return { document, workspace };
}

function sourceUriFrom(input: SourceCommandInput): vscode.Uri | undefined {
	if (input instanceof vscode.Uri) {
		return input;
	}
	return input?.sourceUri;
}

function syncCommandOptions(input: SourceCommandInput): SyncCommandOptions {
	return input instanceof vscode.Uri ? { sourceUri: input } : input ?? {};
}

async function captureForSourceCommand(
	sessions: SessionCoordinator,
	sourceUri: vscode.Uri,
): Promise<Awaited<ReturnType<SessionCoordinator['captureForSource']>>> {
	const existing = await sessions.captureForSource(sourceUri);
	if (existing) {
		return existing;
	}
	const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
	if (!workspace) {
		return undefined;
	}
	const englishUri = englishUriFor(workspace.uri, sourceUri);
	if (!await uriExists(englishUri)) {
		return undefined;
	}
	const loaded = await sessions.load(sourceUri, englishUri);
	return loaded.error ? undefined : sessions.captureForSource(sourceUri);
}

async function offerMissingInterpretation(sourceUri: vscode.Uri | undefined, action: string): Promise<void> {
	if (!sourceUri) {
		await vscode.window.showErrorMessage(`Open a LangClarity interpretation before ${action}.`);
		return;
	}
	const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
	const exists = workspace
		? await uriExists(englishUriFor(workspace.uri, sourceUri))
		: false;
	const button = exists ? 'Open Interpretation' : 'Interpret File';
	const selected = await vscode.window.showInformationMessage(
		exists
			? `Open this file's LangClarity interpretation before ${action}.`
			: `No LangClarity interpretation exists for this file.`,
		button,
	);
	if (selected === button) {
		await vscode.commands.executeCommand(
			exists ? 'langclarity.openEnglishView' : 'langclarity.interpretFile',
			{ sourceUri },
		);
	}
}

function sourceUriForEnglishDocument(document: vscode.TextDocument): vscode.Uri {
	const workspace = vscode.workspace.getWorkspaceFolder(document.uri);
	if (!workspace) {
		throw new Error('The interpretation is no longer inside a workspace.');
	}
	const parsed = parseEnglishDocument(document.getText());
	return vscode.Uri.joinPath(workspace.uri, ...parsed.frontmatter.source.split('/'));
}

async function openInterpretationBeside(uri: vscode.Uri): Promise<void> {
	await vscode.commands.executeCommand(
		'vscode.openWith',
		uri,
		interpretationViewType,
		{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: false, preview: false },
	);
}

async function openMarkdownBeside(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, {
		viewColumn: vscode.ViewColumn.Beside,
		preserveFocus: false,
		preview: false,
	});
}

async function loadSessionAndReport(
	sessions: SessionCoordinator,
	sourceUri: vscode.Uri,
	englishUri: vscode.Uri,
): Promise<void> {
	const snapshot = await sessions.load(sourceUri, englishUri);
	if (snapshot.error) {
		await vscode.window.showErrorMessage(`LangClarity could not load this English document: ${snapshot.error}`);
		return;
	}
	if (snapshot.state === 'CODE_CHANGED') {
		const action = await vscode.window.showInformationMessage(
			'This English interpretation is stale because the source changed.',
			'Refresh Code → English',
		);
		if (action === 'Refresh Code → English') {
			await vscode.commands.executeCommand('langclarity.codeToEnglish', { sourceUri });
		}
	}
}

interface ModelQuickPick extends vscode.QuickPickItem {
	model: CodexModel;
	modelId?: string;
}

interface EffortQuickPick extends vscode.QuickPickItem {
	reasoningEffort?: string;
}

function currentModelPreference(context: vscode.ExtensionContext): CodexModelPreference {
	const modelId = context.workspaceState.get<string>(modelPreferenceKey);
	const reasoningEffort = context.workspaceState.get<string>(reasoningPreferenceKey);
	return {
		...(modelId ? { modelId } : {}),
		...(reasoningEffort ? { reasoningEffort } : {}),
	};
}

async function selectModelPreference(
	context: vscode.ExtensionContext,
	models: CodexModel[],
): Promise<void> {
	const runtimeDefault = models.find((model) => model.isDefault) ?? models[0];
	if (!runtimeDefault) {
		throw new Error('Codex returned no available models.');
	}
	const preference = currentModelPreference(context);
	const modelItems: ModelQuickPick[] = [{
		label: 'Codex default (recommended)',
		description: preference.modelId ? undefined : 'Current',
		detail: `${runtimeDefault.displayName} — ${runtimeDefault.id}`,
		model: runtimeDefault,
	}, ...models.map((model): ModelQuickPick => ({
		label: model.displayName,
		description: model.id === preference.modelId ? 'Current' : model.isDefault ? 'Runtime default' : undefined,
		detail: model.id,
		model,
		modelId: model.id,
	}))];
	const selectedModel = await vscode.window.showQuickPick(modelItems, {
		placeHolder: 'Choose the Codex model for this workspace',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	if (!selectedModel) {
		return;
	}

	const effortItems: EffortQuickPick[] = [{
		label: 'Model default',
		description: preference.reasoningEffort ? undefined : 'Current',
	}, ...selectedModel.model.supportedReasoningEfforts.map((effort): EffortQuickPick => {
		const descriptions = [
			effort === preference.reasoningEffort ? 'Current' : undefined,
			effort === 'medium' ? 'Recommended for Code → English' : undefined,
		].filter((item): item is string => Boolean(item));
		return {
			label: effort,
			description: descriptions.length > 0 ? descriptions.join(' · ') : undefined,
			reasoningEffort: effort,
		};
	})];
	const selectedEffort = await vscode.window.showQuickPick(effortItems, {
		placeHolder: 'Choose a reasoning effort for this workspace',
	});
	if (!selectedEffort) {
		return;
	}

	await context.workspaceState.update(modelPreferenceKey, selectedModel.modelId);
	await context.workspaceState.update(reasoningPreferenceKey, selectedEffort.reasoningEffort);
	const modelLabel = selectedModel.modelId ? selectedModel.model.displayName : 'Codex default';
	await vscode.window.showInformationMessage(
		`LangClarity will use ${modelLabel} with ${selectedEffort.reasoningEffort ?? 'the model-default'} reasoning effort in this workspace.`,
	);
}

async function reportModelResolution(
	context: vscode.ExtensionContext,
	resolution: ModelResolution,
): Promise<void> {
	if (resolution.unavailableModelId) {
		if (context.workspaceState.get<string>(modelPreferenceKey) === resolution.unavailableModelId) {
			await context.workspaceState.update(modelPreferenceKey, undefined);
		}
		await vscode.window.showInformationMessage(
			`The selected Codex model ${resolution.unavailableModelId} is no longer available. LangClarity used the Codex default (${resolution.model}) and reset the workspace model preference.`,
		);
		return;
	}
	if (resolution.modelEnumerationFailed) {
		await vscode.window.showInformationMessage(
			`Codex model enumeration was unavailable. LangClarity used the current Codex default (${resolution.model}) for this operation.`,
		);
	}
}

async function ensureProviderDisclosure(
	context: vscode.ExtensionContext,
	action: string,
): Promise<boolean> {
	if (context.workspaceState.get<boolean>(disclosureKey)) {
		return true;
	}
	const consent = await vscode.window.showWarningMessage(
		'Requested source and English are sent to Codex/OpenAI under the provider\'s policies. LangClarity does not route them through its own backend.',
		{ modal: true },
		action,
	);
	if (consent !== action) {
		return false;
	}
	await context.workspaceState.update(disclosureKey, true);
	return true;
}

export function deactivate(): void {
	const disposable = activeInterpreter as { dispose?: () => void } | undefined;
	disposable?.dispose?.();
	activeInterpreter = undefined;
}
