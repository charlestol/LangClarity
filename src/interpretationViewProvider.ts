import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { deriveSyncState, parseEnglishDocument } from './englishDocument';
import { hashText, MAX_SOURCE_LINES } from './interpretation';
import {
	behaviorRowsForSource,
	interpretationPaneContent,
	replacePaneBehavior,
	type PaneBehaviorItem,
} from './interpretationPaneDocument';

export const interpretationViewType = 'langclarity.interpretationView';

type PaneMessage =
	| { type: 'ready' }
	| { type: 'update'; behavior: unknown }
	| { type: 'save'; behavior: unknown }
	| { type: 'command'; command: unknown; behavior: unknown };

export class InterpretationViewProvider implements vscode.CustomTextEditorProvider {
	constructor(private readonly sourceUriForEnglish: (document: vscode.TextDocument) => vscode.Uri) {}

	resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		panel.webview.options = { enableScripts: true };
		panel.webview.html = paneHtml(panel.webview);
		let lastAppliedText: string | undefined;
		let sourceUri: vscode.Uri | undefined;
		const resolvedSourceUri = (): vscode.Uri => {
			sourceUri ??= this.sourceUriForEnglish(document);
			return sourceUri;
		};
		const currentSourceDocument = async (): Promise<vscode.TextDocument> =>
			vscode.workspace.openTextDocument(resolvedSourceUri());

		const currentState = async (): Promise<string> => {
			const parsed = parseEnglishDocument(document.getText());
			const sourceDocument = await currentSourceDocument();
			return deriveSyncState(
				hashText(sourceDocument.getText()),
				parsed.frontmatter.sourceHash,
				parsed.currentEnglishHashes,
				parsed.frontmatter.editableEnglishHash,
			);
		};

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
				const content = interpretationPaneContent(document.getText());
				const gridLineCount = Math.max(
					sourceDocument.lineCount,
					...content.behavior.map((item) => item.endLine ?? 1),
				);
				await panel.webview.postMessage({
					type: 'content',
					content: {
						...content,
						behavior: behaviorRowsForSource(content.behavior, gridLineCount),
						status: await currentState(),
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

		const updateBehavior = async (rawBehavior: unknown, save: boolean): Promise<boolean> => {
			try {
				const behavior = validBehavior(rawBehavior);
				const currentText = document.getText();
				const updatedText = replacePaneBehavior(currentText, behavior);
				if (updatedText !== currentText) {
					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, fullDocumentRange(document), updatedText);
					lastAppliedText = updatedText;
					if (!await vscode.workspace.applyEdit(edit)) {
						throw new Error('VS Code could not update the interpretation document.');
					}
				}
				if (save && !await document.save()) {
					throw new Error('VS Code could not save the interpretation document.');
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
					const allowedCommands = new Set([
						'langclarity.codeToEnglish',
						'langclarity.englishToCode',
						'langclarity.chooseSyncDirection',
					]);
					if (typeof message.command !== 'string' || !allowedCommands.has(message.command)) {
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
				void sendState();
				return;
			}
			if (event.document.uri.toString() !== document.uri.toString()) {
				return;
			}
			if (lastAppliedText === document.getText()) {
				lastAppliedText = undefined;
				void sendState();
				return;
			}
			void sendContent();
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
			changeSubscription.dispose();
			saveSubscription.dispose();
		});
	}
}

function validBehavior(value: unknown): PaneBehaviorItem[] {
	if (!Array.isArray(value) || value.length > MAX_SOURCE_LINES) {
		throw new Error('The Behavior section contains an invalid number of items.');
	}
	return value.map((item) => {
		if (!item || typeof item !== 'object') {
			throw new Error('The Behavior section contains an invalid item.');
		}
		const candidate = item as Record<string, unknown>;
		if (typeof candidate.statement !== 'string' || candidate.statement.length > 20_000) {
			throw new Error('A Behavior statement is invalid or too long.');
		}
		if (candidate.evidence !== undefined && typeof candidate.evidence !== 'string') {
			throw new Error('A Behavior evidence label is invalid.');
		}
		if (candidate.evidenceSuffix !== undefined
			&& (typeof candidate.evidenceSuffix !== 'string'
				|| !/^_\(\d+–\d+(?:; symbol `(?:[^`]|\\`)+`)?\)_$/u.test(candidate.evidenceSuffix))) {
			throw new Error('A Behavior source reference is invalid.');
		}
		return {
			statement: candidate.statement,
			...(candidate.evidence ? { evidence: candidate.evidence as string } : {}),
			...(candidate.evidenceSuffix ? { evidenceSuffix: candidate.evidenceSuffix as string } : {}),
		};
	});
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
	return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function paneHtml(webview: vscode.Webview): string {
	const nonce = randomBytes(16).toString('base64');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>LangClarity Interpretation</title>
	<style>
		:root { color-scheme: light dark; }
		body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		.header { position: sticky; top: 0; z-index: 2; padding: 18px 22px 12px; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
		.header-row, .actions, .tabs, .behavior-heading { display: flex; align-items: center; gap: 8px; }
		h1 { flex: 1; margin: 0; font-size: 17px; }
		.status { padding: 3px 7px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; color: var(--vscode-descriptionForeground); font-size: 11px; }
		.meta { margin-top: 5px; color: var(--vscode-descriptionForeground); font-size: 12px; }
		.actions { flex-wrap: wrap; margin-top: 12px; }
		button { border: 1px solid var(--vscode-button-border, transparent); padding: 5px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
		[hidden] { display: none !important; }
		.tabs { padding: 0 22px; border-bottom: 1px solid var(--vscode-panel-border); }
		.tab { padding: 10px 2px 8px; margin-right: 16px; color: var(--vscode-descriptionForeground); background: transparent; border: 0; border-bottom: 2px solid transparent; }
		.tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
		main { max-width: 920px; padding: 20px 22px 48px; }
		.panel { display: none; }
		.panel.active { display: block; }
		.behavior-heading { justify-content: space-between; margin-bottom: 12px; }
		h2, h3 { margin: 0; font-size: 15px; }
		.readonly-section { padding: 14px; margin-bottom: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); }
		.behavior-hint { color: var(--vscode-descriptionForeground); font-size: 12px; }
		.behavior-editor { display: grid; grid-template-columns: max-content minmax(0, 1fr); height: min(58vh, 620px); min-height: 300px; overflow: hidden; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
		.behavior-gutter { width: 1ch; min-width: 0; overflow: hidden; padding: 8px 7px 8px 2px; color: var(--vscode-editorLineNumber-foreground); background: var(--vscode-editorGutter-background, var(--vscode-editor-background)); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 22px; text-align: right; user-select: none; }
		.behavior-gutter div { height: 22px; white-space: nowrap; cursor: pointer; }
		.behavior-gutter .mapped { color: var(--vscode-editorLineNumber-activeForeground); }
		.behavior-gutter .active { color: var(--vscode-editorLineNumber-activeForeground); font-weight: 600; }
		#behavior-text { box-sizing: border-box; width: 100%; height: 100%; resize: none; overflow: auto; border: 0; border-left: 1px solid var(--vscode-panel-border); border-radius: 0; padding: 8px 10px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); line-height: 22px; tab-size: 2; white-space: pre; }
		#behavior-text:focus, button:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
		.editor-status { display: flex; justify-content: flex-end; gap: 16px; padding: 4px 10px; border: 1px solid var(--vscode-panel-border); border-top: 0; color: var(--vscode-descriptionForeground); background: var(--vscode-editorWidget-background); font-family: var(--vscode-editor-font-family); font-size: 11px; }
		.readonly-section h3 { margin-bottom: 8px; }
		.readonly-content { white-space: pre-wrap; line-height: 1.55; }
		.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
		#error { display: none; margin: 12px 22px 0; padding: 9px 11px; color: var(--vscode-errorForeground); border: 1px solid var(--vscode-inputValidation-errorBorder); background: var(--vscode-inputValidation-errorBackground); }
		#save-state { color: var(--vscode-descriptionForeground); font-size: 12px; }
	</style>
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
	<div id="error" role="alert"></div>
	<nav class="tabs" aria-label="Interpretation sections">
		<button class="tab active" data-tab="behavior">English Code</button>
		<button class="tab" data-tab="overview">Overview</button>
		<button class="tab" data-tab="structure">Structure</button>
		<button class="tab" data-tab="effects">Effects</button>
	</nav>
	<main>
		<section class="panel active" id="behavior"><div class="behavior-heading"><h2>English Code</h2><span class="behavior-hint">Everyday English, exactly one row per source line</span></div><div class="behavior-editor"><div class="behavior-gutter" id="behavior-gutter" aria-hidden="true"></div><textarea id="behavior-text" wrap="off" spellcheck="true" aria-label="Everyday English translation by source line"></textarea></div><div class="editor-status"><span id="cursor-position">Ln 1, Col 1</span><span>Spaces: 2</span><span>Everyday English</span></div></section>
		<section class="panel" id="overview"></section>
		<section class="panel" id="structure"></section>
		<section class="panel" id="effects"></section>
	</main>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let behavior = [];
		let sourceLineCount = 1;
		let loaded = false;
		let updateTimer;
		const byId = (id) => document.getElementById(id);
		function behaviorPayload() { return behavior.map(({ statement, evidence, evidenceSuffix, startLine, endLine, symbolName }) => ({ statement, evidence, evidenceSuffix, startLine, endLine, symbolName })); }
		function singleLine(value) { return value.split(String.fromCharCode(10)).map((part, index) => index === 0 ? part.trimEnd() : part.trim()).join(' ').trimEnd(); }
		function exactRow(statement, index) { const line = index + 1; return { statement, evidence: 'Line ' + String(line), evidenceSuffix: '_(' + String(line) + '–' + String(line) + ')_', startLine: line, endLine: line }; }
		function editorPosition(input) { const newline = String.fromCharCode(10); const before = input.value.slice(0, input.selectionStart); const line = before.split(newline).length; const lastBreak = before.lastIndexOf(newline); return { line, column: input.selectionStart - lastBreak }; }
		function updateEditorPosition() { const input = byId('behavior-text'); const position = editorPosition(input); byId('cursor-position').textContent = 'Ln ' + String(position.line) + ', Col ' + String(position.column); Array.from(byId('behavior-gutter').children).forEach((line, index) => line.classList.toggle('active', index + 1 === position.line)); }
		function lineOffset(value, lineIndex) { const newline = String.fromCharCode(10); let offset = 0; for (let index = 0; index < lineIndex; index += 1) { const next = value.indexOf(newline, offset); if (next < 0) return value.length; offset = next + 1; } return offset; }
		function replaceText(input, start, end, replacement, selectionMode) { input.setRangeText(replacement, start, end, selectionMode || 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); }
		function setStatus(status) { const labels = { SYNCED: 'Synced', CODE_CHANGED: 'Code changed', ENGLISH_CHANGED: 'English changed', BOTH_CHANGED: 'Both changed' }; byId('status').textContent = labels[status] || status; showSuggestedAction(status); }
		function showSuggestedAction(status) {
			const actions = {
				CODE_CHANGED: { label: 'Apply Code → English', command: 'langclarity.codeToEnglish' },
				ENGLISH_CHANGED: { label: 'Review & Apply English → Code', command: 'langclarity.englishToCode' },
				BOTH_CHANGED: { label: 'Choose Apply Direction…', command: 'langclarity.chooseSyncDirection' },
			};
			const action = actions[status]; const button = byId('suggested-action');
			if (!action) { button.hidden = true; return; }
			button.textContent = action.label; button.dataset.suggestedCommand = action.command; button.hidden = false;
		}
		function scheduleUpdate() { clearTimeout(updateTimer); byId('save-state').textContent = 'Edited'; updateTimer = setTimeout(() => vscode.postMessage({ type: 'update', behavior: behaviorPayload() }), 400); }
		function flush(type, command) { if (!loaded && command !== 'langclarity.openMarkdown') return; clearTimeout(updateTimer); vscode.postMessage({ type, command, behavior: behaviorPayload() }); }
		function renderBehavior() {
			const input = byId('behavior-text');
			input.value = behavior.map((item) => singleLine(item.statement)).join(String.fromCharCode(10));
			renderGutter();
			updateEditorPosition();
		}
		function renderGutter() {
			const gutter = byId('behavior-gutter'); gutter.textContent = ''; gutter.style.width = String(String(Math.max(1, behavior.length)).length) + 'ch';
			behavior.forEach((item, index) => { const line = document.createElement('div'); line.textContent = String(index + 1); if (item.statement.length > 0) { line.className = 'mapped'; line.title = item.evidence || ('Source line ' + String(index + 1)); } line.addEventListener('click', () => { const input = byId('behavior-text'); const offset = lineOffset(input.value, index); input.focus(); input.setSelectionRange(offset, offset); updateEditorPosition(); }); gutter.appendChild(line); });
		}
		function renderReadonly(id, sections) {
			const root = byId(id); root.textContent = '';
			sections.forEach((section) => { const card = document.createElement('div'); card.className = 'readonly-section'; const heading = document.createElement('h3'); heading.textContent = section.heading; const content = document.createElement('div'); content.className = 'readonly-content'; content.textContent = section.content || 'None identified.'; card.append(heading, content); root.appendChild(card); });
		}
		document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab, .panel').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); byId(tab.dataset.tab).classList.add('active'); }));
		document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => flush('command', button.dataset.command)));
		byId('suggested-action').addEventListener('click', (event) => flush('command', event.currentTarget.dataset.suggestedCommand));
		byId('save').addEventListener('click', () => flush('save'));
		byId('behavior-text').addEventListener('input', (event) => { const lines = event.target.value.split(String.fromCharCode(10)); while (lines.length < sourceLineCount) lines.push(''); behavior = lines.map((statement, index) => exactRow(statement, index)); if (event.target.value.split(String.fromCharCode(10)).length < sourceLineCount) event.target.value = behavior.map((item) => singleLine(item.statement)).join(String.fromCharCode(10)); renderGutter(); updateEditorPosition(); scheduleUpdate(); });
		byId('behavior-text').addEventListener('keydown', (event) => { if (event.key !== 'Tab') return; event.preventDefault(); const input = event.target; if (input.selectionStart !== input.selectionEnd) { const start = lineOffset(input.value, editorPosition({ value: input.value, selectionStart: input.selectionStart }).line - 1); const newline = String.fromCharCode(10); const selected = input.value.slice(start, input.selectionEnd); const replacement = selected.split(newline).map((line) => event.shiftKey ? (line.startsWith('  ') ? line.slice(2) : line.startsWith(' ') ? line.slice(1) : line) : '  ' + line).join(newline); replaceText(input, start, input.selectionEnd, replacement, 'select'); } else if (event.shiftKey) { const start = lineOffset(input.value, editorPosition(input).line - 1); const removable = input.value.slice(start, input.selectionStart).endsWith('  ') ? 2 : input.value.slice(start, input.selectionStart).endsWith(' ') ? 1 : 0; if (removable > 0) replaceText(input, input.selectionStart - removable, input.selectionStart, '', 'end'); } else { replaceText(input, input.selectionStart, input.selectionEnd, '  ', 'end'); } });
		byId('behavior-text').addEventListener('scroll', (event) => { byId('behavior-gutter').scrollTop = event.target.scrollTop; });
		['click', 'keyup', 'select'].forEach((name) => byId('behavior-text').addEventListener(name, updateEditorPosition));
		document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush('save'); } });
		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type === 'content') { const content = message.content; sourceLineCount = Math.max(1, content.sourceLineCount); behavior = content.behavior; loaded = true; byId('source').textContent = content.source; byId('meta').textContent = 'Model: ' + content.model + ' · Interpreted ' + new Date(content.interpretedAt).toLocaleString(); setStatus(content.status); renderBehavior(); renderReadonly('overview', content.overview); renderReadonly('structure', content.structure); renderReadonly('effects', content.effects); byId('error').style.display = 'none'; }
			if (message.type === 'status') { setStatus(message.status); }
			if (message.type === 'error') { byId('suggested-action').hidden = true; byId('error').textContent = message.message; byId('error').style.display = 'block'; }
			if (message.type === 'saved') { byId('save-state').textContent = message.saved ? 'Saved' : 'Edited'; }
			if (message.type === 'documentSaved') { setStatus(message.status); }
		});
		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
