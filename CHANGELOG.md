# Change Log

## 0.0.1 — MVP preview

- Added editor and Explorer right-click actions for supported source files.
- Added a Markdown-backed interpretation pane with editable Behavior and read-only supporting tabs.
- Existing interpretations can now be opened without applying model-operation source limits.
- Added Open Interpretation Markdown to open the paired .langclarity Markdown beside the source.
- English → Code now refreshes every interpretation section from the approved proposed source before applying either document.
- Replaced Behavior cards with one source-line text editor whose VS Code-style gutter exposes an editable row for every source line.
- Behavior Enter keypresses now insert a row and shift current and following English content down like a normal text editor.
- Added editor-style indentation, active-line gutter state, clickable line navigation, and caret position status to Behavior.
- Saving changed English or source now reveals its applicable synchronization action directly in the interpretation pane.
- Code → English now produces exactly one concise everyday-language row per source line, carries context through parent rows and indentation, preserves known literal values verbatim, and persists blank aligned rows.
- Context menus and the Command Palette now hide actions that do not apply to the active file or its interpretation state.
- The Behavior editor's line-number gutter now grows responsively with the number of displayed digits.
- English Code now grows vertically with its rows and uses pane-level vertical scrolling while retaining horizontal scrolling for long rows.
- All interpretation tabs now reuse one full-width, content-growing, pane-scrolling layout without horizontal content insets.
- Renamed the pane's Behavior label to English Code and replaced permanent sync buttons with one state-valid action.
- Added persistent Code → English interpretations for TypeScript and JavaScript, including React (.ts, .tsx, .js, and .jsx).
- Interpretation refreshes now populate verified top-level definitions, direct dependencies, and related workspace files from TypeScript module resolution.
- Added editable English → Code proposals with syntax validation, VS Code diff review, and explicit apply.
- Added deterministic synchronized, code-changed, English-changed, and both-changed states.
- Added a status-bar sync surface for Synced, Code changed, English changed, Both changed, and Invalid English.
- Added paired-file move and orphan preservation behavior.
- After the first interpretation, offers an explicit prompt to add /.langclarity/ to .gitignore, plus the Add .langclarity to .gitignore command.
- Added cancellation, retry, account/usage states, limits, and stale-response safeguards.
- Added runtime-backed Codex model/reasoning selection with safe default fallback.
- Improved sync responsiveness with a warm Codex client pool, overlapping English refresh during proposal review, and a media/interpretationView.js pane script.
- Added an interpretation-fidelity corpus with 12 fixtures, deterministic scoring, live-run recording, and benchmark:fidelity / corpus:fidelity scripts.
- Added onboarding, privacy, accessibility, troubleshooting, test, and packaging documentation.
