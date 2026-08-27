const vscode = acquireVsCodeApi();
let behavior = [];
let sourceLineCount = 1;
let loaded = false;
let updateTimer;
let activeGutterIndex = -1;
const byId = (id) => document.getElementById(id);
function behaviorPayload() { return behavior.map((item) => item.statement); }
function singleLine(value) { return value.split(String.fromCharCode(10)).map((part, index) => index === 0 ? part.trimEnd() : part.trim()).join(' ').trimEnd(); }
function exactRow(statement, index) { const line = index + 1; return { statement, evidence: 'Line ' + String(line), evidenceSuffix: '_(' + String(line) + '–' + String(line) + ')_', startLine: line, endLine: line }; }
function editorPosition(input) { let line = 1; let lastBreak = -1; for (let index = 0; index < input.selectionStart; index += 1) { if (input.value.charCodeAt(index) === 10) { line += 1; lastBreak = index; } } return { line, column: input.selectionStart - lastBreak }; }
function updateEditorPosition() { const input = byId('behavior-text'); const position = editorPosition(input); byId('cursor-position').textContent = 'Ln ' + String(position.line) + ', Col ' + String(position.column); const nextIndex = position.line - 1; if (nextIndex !== activeGutterIndex) { const gutter = byId('behavior-gutter'); gutter.children[activeGutterIndex]?.classList.remove('active'); gutter.children[nextIndex]?.classList.add('active'); activeGutterIndex = nextIndex; } }
function lineOffset(value, lineIndex) { const newline = String.fromCharCode(10); let offset = 0; for (let index = 0; index < lineIndex; index += 1) { const next = value.indexOf(newline, offset); if (next < 0) return value.length; offset = next + 1; } return offset; }
function replaceText(input, start, end, replacement, selectionMode) { input.setRangeText(replacement, start, end, selectionMode || 'end'); input.dispatchEvent(new Event('input', { bubbles: true })); }
function setStatus(status) { const labels = { SYNCED: 'Synced', CODE_CHANGED: 'Code changed', ENGLISH_CHANGED: 'English changed', BOTH_CHANGED: 'Both changed' }; byId('status').textContent = labels[status] || status; showSuggestedAction(status); }
function setRepositoryContextStatus(status) { const labels = { CURRENT: 'Repository context: Current', STALE: 'Repository context: Out of date' }; const badge = byId('repository-context-status'); badge.textContent = labels[status] || 'Repository context: Unavailable'; badge.dataset.state = status; byId('refresh-repository-context').hidden = status !== 'STALE'; }
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
function syncEditorRows() { byId('behavior-text').rows = Math.max(1, behavior.length); }
function renderBehavior() {
	const input = byId('behavior-text');
	input.value = behavior.map((item) => singleLine(item.statement)).join(String.fromCharCode(10));
	syncEditorRows();
	renderGutter();
	updateEditorPosition();
}
function renderGutter() {
	const gutter = byId('behavior-gutter');
	if (gutter.children.length !== behavior.length) { const fragment = document.createDocumentFragment(); behavior.forEach((_item, index) => { const line = document.createElement('div'); line.textContent = String(index + 1); line.addEventListener('click', () => { const input = byId('behavior-text'); const offset = lineOffset(input.value, index); input.focus(); input.setSelectionRange(offset, offset); updateEditorPosition(); }); fragment.appendChild(line); }); gutter.replaceChildren(fragment); activeGutterIndex = -1; }
	behavior.forEach((item, index) => { const line = gutter.children[index]; const mapped = item.statement.length > 0; line.classList.toggle('mapped', mapped); line.title = mapped ? item.evidence || ('Source line ' + String(index + 1)) : ''; });
}
function renderReadonly(id, sections) {
	const root = byId(id); root.textContent = '';
	sections.forEach((section) => { const card = document.createElement('div'); card.className = 'readonly-section'; const heading = document.createElement('h3'); heading.textContent = section.heading; const content = document.createElement('div'); content.className = 'readonly-content'; content.textContent = section.content || 'None identified.'; card.append(heading, content); root.appendChild(card); });
}
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab, .panel').forEach((item) => item.classList.remove('active')); tab.classList.add('active'); byId(tab.dataset.tab).classList.add('active'); }));
document.querySelectorAll('[data-command]').forEach((button) => button.addEventListener('click', () => flush('command', button.dataset.command)));
byId('suggested-action').addEventListener('click', (event) => flush('command', event.currentTarget.dataset.suggestedCommand));
byId('save').addEventListener('click', () => flush('save'));
byId('refresh-repository-context').addEventListener('click', () => flush('refreshRepositoryContext'));
byId('behavior-text').addEventListener('input', (event) => { const lines = event.target.value.split(String.fromCharCode(10)); const needsPadding = lines.length < sourceLineCount; while (lines.length < sourceLineCount) lines.push(''); behavior = lines.map((statement, index) => exactRow(statement, index)); if (needsPadding) event.target.value = behavior.map((item) => singleLine(item.statement)).join(String.fromCharCode(10)); syncEditorRows(); renderGutter(); updateEditorPosition(); scheduleUpdate(); });
byId('behavior-text').addEventListener('keydown', (event) => { if (event.key !== 'Tab') return; event.preventDefault(); const input = event.target; if (input.selectionStart !== input.selectionEnd) { const start = lineOffset(input.value, editorPosition({ value: input.value, selectionStart: input.selectionStart }).line - 1); const newline = String.fromCharCode(10); const selected = input.value.slice(start, input.selectionEnd); const replacement = selected.split(newline).map((line) => event.shiftKey ? (line.startsWith('  ') ? line.slice(2) : line.startsWith(' ') ? line.slice(1) : line) : '  ' + line).join(newline); replaceText(input, start, input.selectionEnd, replacement, 'select'); } else if (event.shiftKey) { const start = lineOffset(input.value, editorPosition(input).line - 1); const removable = input.value.slice(start, input.selectionStart).endsWith('  ') ? 2 : input.value.slice(start, input.selectionStart).endsWith(' ') ? 1 : 0; if (removable > 0) replaceText(input, input.selectionStart - removable, input.selectionStart, '', 'end'); } else { replaceText(input, input.selectionStart, input.selectionEnd, '  ', 'end'); } });
['click', 'keyup', 'select'].forEach((name) => byId('behavior-text').addEventListener(name, updateEditorPosition));
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); flush('save'); } });
window.addEventListener('message', (event) => {
	const message = event.data;
	if (message.type === 'content') { const content = message.content; sourceLineCount = Math.max(1, content.sourceLineCount); behavior = content.behavior; loaded = true; byId('source').textContent = content.source; byId('meta').textContent = 'Model: ' + content.model + ' · Interpreted ' + new Date(content.interpretedAt).toLocaleString(); setStatus(content.status); setRepositoryContextStatus(content.repositoryContextStatus); renderBehavior(); renderReadonly('overview', content.overview); renderReadonly('structure', content.structure); renderReadonly('effects', content.effects); byId('error').hidden = true; }
	if (message.type === 'status') { setStatus(message.status); setRepositoryContextStatus(message.repositoryContextStatus); }
	if (message.type === 'error') { byId('suggested-action').hidden = true; byId('error').textContent = message.message; byId('error').hidden = false; }
	if (message.type === 'saved') { byId('save-state').textContent = message.saved ? 'Saved' : 'Edited'; }
	if (message.type === 'documentSaved') { setStatus(message.status); setRepositoryContextStatus(message.repositoryContextStatus); }
});
vscode.postMessage({ type: 'ready' });
