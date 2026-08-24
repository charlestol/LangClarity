import path from 'node:path';
import * as vscode from 'vscode';
import {
	deriveSyncState,
	parseEnglishDocument,
	type ParsedEnglishDocument,
	type StableSyncState,
} from './englishDocument';
import { hashText } from './hash';
import { relativeSourcePath } from './interpretation';

const REFRESH_DEBOUNCE_MS = 150;

export type SessionState = StableSyncState | 'ERROR';

export interface SessionSnapshot {
	state: SessionState;
	error?: string;
}

export interface SessionCapture {
	sourceUri: vscode.Uri;
	englishUri: vscode.Uri;
	state: StableSyncState;
	sourceText: string;
	englishText: string;
	sourceHash: string;
	editableEnglishHash: string;
	englishDocumentHash: string;
	parsedEnglish: ParsedEnglishDocument;
}

interface FileSession {
	sourceUri: vscode.Uri;
	englishUri: vscode.Uri;
	state: SessionState;
	error?: string;
	revision: number;
	refreshTimer?: NodeJS.Timeout;
}

export class SessionCoordinator implements vscode.Disposable {
	private readonly sessionsBySource = new Map<string, FileSession>();
	private readonly sessionsByEnglish = new Map<string, FileSession>();
	private readonly status: vscode.StatusBarItem;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(private readonly output: vscode.OutputChannel) {
		this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
		this.status.name = 'LangClarity synchronization status';
		this.disposables.push(
			this.status,
			vscode.workspace.onDidChangeTextDocument((event) => this.refreshUri(event.document.uri)),
			vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
		);

		const sourceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx}');
		const englishWatcher = vscode.workspace.createFileSystemWatcher('**/.langclarity/**/*.md');
		for (const watcher of [sourceWatcher, englishWatcher]) {
			this.disposables.push(watcher);
			watcher.onDidChange((uri) => this.refreshUri(uri), undefined, this.disposables);
			watcher.onDidDelete((uri) => this.refreshUri(uri), undefined, this.disposables);
		}
	}

	async load(sourceUri: vscode.Uri, englishUri: vscode.Uri): Promise<SessionSnapshot> {
		const sourceKey = sourceUri.toString();
		const existing = this.sessionsBySource.get(sourceKey);
		if (existing) {
			this.sessionsByEnglish.delete(existing.englishUri.toString());
		}
		const session: FileSession = existing ?? {
			sourceUri,
			englishUri,
			state: 'ERROR',
			revision: 0,
		};
		session.englishUri = englishUri;
		this.sessionsBySource.set(sourceKey, session);
		this.sessionsByEnglish.set(englishUri.toString(), session);
		await this.refresh(session);
		return { state: session.state, ...(session.error ? { error: session.error } : {}) };
	}

	async captureActive(): Promise<SessionCapture | undefined> {
		const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
		const session = activeUri
			? this.sessionsBySource.get(activeUri) ?? this.sessionsByEnglish.get(activeUri)
			: undefined;
		if (!session) {
			return undefined;
		}
		return this.capture(session);
	}

	async captureForSource(sourceUri: vscode.Uri): Promise<SessionCapture | undefined> {
		const session = this.sessionsBySource.get(sourceUri.toString());
		return session ? this.capture(session) : undefined;
	}

	async reload(sourceUri: vscode.Uri): Promise<SessionSnapshot | undefined> {
		const session = this.sessionsBySource.get(sourceUri.toString());
		if (!session) {
			return undefined;
		}
		await this.refresh(session);
		return { state: session.state, ...(session.error ? { error: session.error } : {}) };
	}

	forget(sourceUri: vscode.Uri): void {
		const session = this.sessionsBySource.get(sourceUri.toString());
		if (!session) {
			return;
		}
		this.cancelScheduledRefresh(session);
		this.sessionsBySource.delete(sourceUri.toString());
		this.sessionsByEnglish.delete(session.englishUri.toString());
		this.updateStatus();
	}

	dispose(): void {
		for (const session of this.sessionsBySource.values()) {
			this.cancelScheduledRefresh(session);
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private refreshUri(uri: vscode.Uri): void {
		const session = this.sessionsBySource.get(uri.toString())
			?? this.sessionsByEnglish.get(uri.toString());
		if (session) {
			this.scheduleRefresh(session);
		}
	}

	private scheduleRefresh(session: FileSession): void {
		this.cancelScheduledRefresh(session);
		session.revision += 1;
		session.refreshTimer = setTimeout(() => {
			session.refreshTimer = undefined;
			void this.refresh(session);
		}, REFRESH_DEBOUNCE_MS);
	}

	private cancelScheduledRefresh(session: FileSession): void {
		if (session.refreshTimer) {
			clearTimeout(session.refreshTimer);
			session.refreshTimer = undefined;
		}
	}

	private async refresh(session: FileSession): Promise<void> {
		this.cancelScheduledRefresh(session);
		const revision = ++session.revision;
		const previousState = session.state;
		try {
			const [sourceText, englishText] = await Promise.all([
				readCurrentText(session.sourceUri),
				readCurrentText(session.englishUri),
			]);
			const parsed = parseEnglishDocument(englishText);
			const workspace = vscode.workspace.getWorkspaceFolder(session.sourceUri);
			if (!workspace) {
				throw new Error('The paired source is no longer inside a workspace.');
			}
			const expectedSource = relativeSourcePath(workspace.uri, session.sourceUri);
			if (parsed.frontmatter.source !== expectedSource) {
				throw new Error('The English document points to a different source file.');
			}
			if (revision !== session.revision) {
				return;
			}
			session.state = deriveSyncState(
				hashText(sourceText),
				parsed.frontmatter.sourceHash,
				parsed.currentEnglishHashes,
				parsed.frontmatter.editableEnglishHash,
			);
			session.error = undefined;
		} catch (error) {
			if (revision !== session.revision) {
				return;
			}
			session.state = 'ERROR';
			session.error = error instanceof Error ? error.message : 'The English document could not be loaded.';
			if (previousState !== 'ERROR') {
				this.output.appendLine(
					`session:error category=markdown file=${path.posix.basename(session.sourceUri.path)}`,
				);
			}
		}
		this.updateStatus();
	}

	private async capture(session: FileSession): Promise<SessionCapture> {
		this.cancelScheduledRefresh(session);
		session.revision += 1;
		const [sourceText, englishText] = await Promise.all([
			readCurrentText(session.sourceUri),
			readCurrentText(session.englishUri),
		]);
		const parsedEnglish = parseEnglishDocument(englishText);
		const workspace = vscode.workspace.getWorkspaceFolder(session.sourceUri);
		if (!workspace) {
			throw new Error('The paired source is no longer inside a workspace.');
		}
		const expectedSource = relativeSourcePath(workspace.uri, session.sourceUri);
		if (parsedEnglish.frontmatter.source !== expectedSource) {
			throw new Error('The English document points to a different source file.');
		}
		const sourceHash = hashText(sourceText);
		const editableEnglishHash = parsedEnglish.currentEnglishHashes[0];
		const state = deriveSyncState(
			sourceHash,
			parsedEnglish.frontmatter.sourceHash,
			parsedEnglish.currentEnglishHashes,
			parsedEnglish.frontmatter.editableEnglishHash,
		);
		session.state = state;
		session.error = undefined;
		this.updateStatus();
		return {
			sourceUri: session.sourceUri,
			englishUri: session.englishUri,
			state,
			sourceText,
			englishText,
			sourceHash,
			editableEnglishHash,
			englishDocumentHash: hashText(englishText),
			parsedEnglish,
		};
	}

	private updateStatus(): void {
		const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
		const session = activeUri
			? this.sessionsBySource.get(activeUri) ?? this.sessionsByEnglish.get(activeUri)
			: undefined;
		if (!session) {
			this.status.hide();
			return;
		}

		const presentation = statusPresentation(session.state);
		this.status.text = presentation.text;
		this.status.tooltip = session.error ?? presentation.tooltip;
		this.status.command = syncCommandForState(session.state);
		this.status.accessibilityInformation = {
			label: session.error
				? `LangClarity error: ${session.error}`
				: `LangClarity synchronization status: ${presentation.tooltip}`,
			...(this.status.command ? { role: 'button' } : {}),
		};
		this.status.show();
	}
}

export function syncCommandForState(state: SessionState): string | undefined {
	switch (state) {
		case 'CODE_CHANGED': return 'langclarity.codeToEnglish';
		case 'ENGLISH_CHANGED': return 'langclarity.englishToCode';
		case 'BOTH_CHANGED': return 'langclarity.chooseSyncDirection';
		case 'SYNCED':
		case 'ERROR': return undefined;
	}
}

async function readCurrentText(uri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
	if (open) {
		return open.getText();
	}
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

function statusPresentation(state: SessionState): { text: string; tooltip: string } {
	switch (state) {
		case 'SYNCED':
			return { text: '$(check) LangClarity: Synced', tooltip: 'Code and English match their synchronized baselines.' };
		case 'CODE_CHANGED':
			return { text: '$(warning) LangClarity: Code changed', tooltip: 'English is stale because the source changed.' };
		case 'ENGLISH_CHANGED':
			return { text: '$(edit) LangClarity: English changed', tooltip: 'English has edits that are not reflected in code.' };
		case 'BOTH_CHANGED':
			return { text: '$(warning) LangClarity: Both changed', tooltip: 'Code and English both changed; choose an authoritative direction before synchronizing.' };
		case 'ERROR':
			return { text: '$(error) LangClarity: Invalid English', tooltip: 'The paired English document is invalid.' };
	}
}
