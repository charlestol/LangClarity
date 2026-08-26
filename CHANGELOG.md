# Change Log

## 0.0.1 — MVP preview

### Interpretation

- **Code → English** for `.ts`, `.tsx`, `.js`, and `.jsx`; one concise row per source line
- Markdown storage at `.langclarity/` with rename/move pairing and orphan preservation
- Interpretation pane with editable **English Code**, plus read-only Overview, Structure, and Effects
- Reopen existing pairs without model size limits; **Open Interpretation Markdown** for the raw file

### Synchronization

- Explicit **Code → English** and **English → Code** with diff review, syntax validation, and apply/cancel
- Sync states (Synced, Code changed, English changed, Both changed, Invalid English) on the status bar and in the pane
- No sync on open, save, idle, or keystroke; no auto-merge when both sides changed independently

### Codex and privacy

- Model/reasoning selection from your local Codex runtime
- Provider disclosure before the first operation; no LangClarity backend, telemetry, or API-key prompts
- Isolated Codex runtime with tools disabled; optional **Add .langclarity to .gitignore**

### Workspace integration

- **LangClarity** right-click submenu in the editor and Explorer; Command Palette as a secondary entry point
- Structure tab: top-level definitions, dependencies, and direct workspace imports from TypeScript resolution

### Notes

- Verified on macOS with Codex 0.148.0-alpha.15+ and ChatGPT sign-in
- AI output may be incomplete—review English claims and every proposed diff before applying
