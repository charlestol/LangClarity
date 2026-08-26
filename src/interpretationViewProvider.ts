import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
	deriveSyncState,
	parseEnglishDocument,
	type ParsedEnglishDocument,
} from './englishDocument';
import { hashText, MAX_SOURCE_LINES } from './interpretation';
import {
	behaviorRowsForSource,
	interpretationPaneContent,
	paneBehaviorSectionEdit,
	type PaneBehaviorItem,
} from './interpretationPaneDocument';

export const interpretationViewType = 'langclarity.interpretationView';
const allowedSyncCommands = new Set([
	'langclarity.codeToEnglish',
	'langclarity.englishToCode',
	'langclarity.chooseSyncDirection',
]);
const PANE_SYNC_DEBOUNCE_MS = 150;

type PaneMessage =
	| { type: 'ready' }
	| { type: 'update'; behavior: unknown }
	| { type: 'save'; behavior: unknown }
	| { type: 'command'; command: unknown; behavior: unknown };

type PendingPaneRefresh = 'state' | 'content';

export class InterpretationViewProvider implements vscode.CustomTextEditorProvider {
	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly sourceUriForEnglish: (document: vscode.TextDocument) => vscode.Uri,
	) {}

	resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
		panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
		panel.webview.html = paneHtml(
			panel.webview,
			panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'interpretationView.css')),
			panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'interpretationView.js')),
		);
		let lastAppliedText: string | undefined;
		let sourceUri: vscode.Uri | undefined;
		let pendingRefresh: PendingPaneRefresh | undefined;
		let refreshTimer: NodeJS.Timeout | undefined;
		const resolvedSourceUri = (): vscode.Uri => {
			sourceUri ??= this.sourceUriForEnglish(document);
			return sourceUri;
		};
		const currentSourceDocument = async (): Promise<vscode.TextDocument> =>
			vscode.workspace.openTextDocument(resolvedSourceUri());

		const syncState = (
			parsed: ParsedEnglishDocument,
			sourceDocument: vscode.TextDocument,
		): string => {
			return deriveSyncState(
				hashText(sourceDocument.getText()),
				parsed.frontmatter.sourceHash,
				parsed.currentEnglishHashes,
				parsed.frontmatter.editableEnglishHash,
			);
		};
		const currentState = async (): Promise<string> => syncState(
			parseEnglishDocument(document.getText()),
			await currentSourceDocument(),
		);

		const sendState = async (): Promise<void> => {
			try {
				await panel.webview.postMessage({ type: 'status', status: await currentState() });
			} catch (error) {
				await panel.webview.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : 'Synchronization state could not be determined.',
				});
			}
		};

		const sendContent = async (): Promise<void> => {
			try {
				const sourceDocument = await currentSourceDocument();
				const parsed = parseEnglishDocument(document.getText());
				const content = interpretationPaneContent(parsed);
				const gridLineCount = Math.max(
					sourceDocument.lineCount,
					...content.behavior.map((item) => item.endLine ?? 1),
				);
				await panel.webview.postMessage({
					type: 'content',
					content: {
						...content,
						behavior: behaviorRowsForSource(content.behavior, gridLineCount),
						status: syncState(parsed, sourceDocument),
						sourceLineCount: sourceDocument.lineCount,
					},
				});
			} catch (error) {
				await panel.webview.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : 'The interpretation could not be displayed.',
				});
			}
		};

		const scheduleRefresh = (kind: PendingPaneRefresh): void => {
			pendingRefresh = pendingRefresh === 'content' || kind === 'content' ? 'content' : 'state';
			if (refreshTimer) {
				clearTimeout(refreshTimer);
			}
			refreshTimer = setTimeout(() => {
				refreshTimer = undefined;
				const refresh = pendingRefresh;
				pendingRefresh = undefined;
				if (refresh === 'content') {
					void sendContent();
				} else if (refresh === 'state') {
					void sendState();
				}
			}, PANE_SYNC_DEBOUNCE_MS);
		};

		const updateBehavior = async (rawBehavior: unknown, save: boolean): Promise<boolean> => {
			try {
				const behavior = validBehavior(rawBehavior);
				const currentText = document.getText();
				const sectionEdit = paneBehaviorSectionEdit(currentText, behavior);
				if (sectionEdit.updatedText !== currentText) {
					const edit = new vscode.WorkspaceEdit();
					edit.replace(
						document.uri,
						new vscode.Range(
							document.positionAt(sectionEdit.startOffset),
							document.positionAt(sectionEdit.endOffset),
						),
						sectionEdit.replacement,
					);
					lastAppliedText = sectionEdit.updatedText;
					if (!await vscode.workspace.applyEdit(edit)) {
						throw new Error('VS Code could not update the interpretation document.');
					}
				}
				if (save) {
					parseEnglishDocument(document.getText());
					if (!await document.save()) {
						throw new Error('VS Code could not save the interpretation document.');
					}
				}
				await panel.webview.postMessage({ type: 'saved', saved: save });
				await sendState();
				return true;
			} catch (error) {
				await panel.webview.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : 'The Behavior section could not be updated.',
				});
				return false;
			}
		};

		panel.webview.onDidReceiveMessage(async (message: PaneMessage) => {
			switch (message.type) {
				case 'ready':
					await sendContent();
					break;
				case 'update':
					await updateBehavior(message.behavior, false);
					break;
				case 'save':
					await updateBehavior(message.behavior, true);
					break;
				case 'command': {
					if (message.command === 'langclarity.openMarkdown') {
						await vscode.window.showTextDocument(document, {
							viewColumn: vscode.ViewColumn.Beside,
							preserveFocus: false,
							preview: false,
						});
						return;
					}
					if (!await updateBehavior(message.behavior, false)) {
						return;
					}
					if (typeof message.command !== 'string' || !allowedSyncCommands.has(message.command)) {
						return;
					}
					await vscode.commands.executeCommand(message.command, {
						sourceUri: resolvedSourceUri(),
					});
					break;
				}
			}
		});

		const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
			if (sourceUri && event.document.uri.toString() === sourceUri.toString()) {
				scheduleRefresh('content');
				return;
			}
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (lastAppliedText === document.getText()) {
				lastAppliedText = undefined;
				scheduleRefresh('state');
				return;
			}
			scheduleRefresh('content');
		});
		const saveSubscription = vscode.workspace.onDidSaveTextDocument((savedDocument) => {
			const englishSaved = savedDocument.uri.toString() === document.uri.toString();
			const sourceSaved = savedDocument.uri.toString() === resolvedSourceUri().toString();
			if (!englishSaved && !sourceSaved) {
				return;
			}
			void (async () => {
				if (englishSaved) {
					await panel.webview.postMessage({ type: 'saved', saved: true });
				}
				try {
					await panel.webview.postMessage({
						type: 'documentSaved',
						status: await currentState(),
					});
				} catch (error) {
					await panel.webview.postMessage({
						type: 'error',
						message: error instanceof Error ? error.message : 'Synchronization state could not be determined.',
					});
				}
			})();
		});
		panel.onDidDispose(() => {
			if (refreshTimer) {
				clearTimeout(refreshTimer);
			}
			changeSubscription.dispose();
			saveSubscription.dispose();
		});
	}
}

function validBehavior(value: unknown): PaneBehaviorItem[] {
	if (!Array.isArray(value) || value.length > MAX_SOURCE_LINES) {
		throw new Error('The Behavior section contains an invalid number of items.');
	}
	return value.map((statement, index) => {
		if (typeof statement !== 'string' || statement.length > 20_000) {
			throw new Error('A Behavior statement is invalid or too long.');
		}
		const line = index + 1;
		return {
			statement,
			evidence: `Line ${line}`,
			evidenceSuffix: `_(${line}–${line})_`,
			startLine: line,
			endLine: line,
		};
	});
}

function paneHtml(webview: vscode.Webview, stylesheetUri: vscode.Uri, scriptUri: vscode.Uri): string {
	const nonce = randomBytes(16).toString('base64');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${stylesheetUri}">
	<title>LangClarity Interpretation</title>
</head>
<body>
	<div class="header">
		<div class="header-row"><h1 id="source">LangClarity</h1><span class="status" id="status">Loading</span><span id="save-state"></span></div>
		<div class="meta" id="meta"></div>
		<div class="actions">
			<button id="suggested-action" hidden></button>
			<button class="secondary" id="save">Save</button>
			<button class="secondary" data-command="langclarity.openMarkdown">Open Markdown</button>
		</div>
	</div>
	<div id="error" role="alert" hidden></div>
	<nav class="tabs" aria-label="Interpretation sections">
		<button class="tab active" data-tab="behavior">English Code</button>
		<button class="tab" data-tab="overview">Overview</button>
		<button class="tab" data-tab="structure">Structure</button>
		<button class="tab" data-tab="effects">Effects</button>
	</nav>
	<main>
		<section class="panel active" id="behavior"><div class="behavior-editor"><div class="behavior-gutter" id="behavior-gutter" aria-hidden="true"></div><textarea id="behavior-text" rows="1" wrap="off" spellcheck="true" aria-label="Everyday English translation by source line"></textarea></div><div class="editor-status"><span id="cursor-position">Ln 1, Col 1</span><span>Spaces: 2</span><span>Everyday English</span></div></section>
		<section class="panel" id="overview"></section>
		<section class="panel" id="structure"></section>
		<section class="panel" id="effects"></section>
	</main>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
