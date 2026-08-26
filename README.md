# LangClarity

LangClarity is a preview VS Code extension that gives a TypeScript or JavaScript file a persistent, editable structured-English representation. Code and English remain ordinary workspace files, and synchronization happens only when you explicitly choose a direction.

## What it does

- Interprets `.ts`, `.tsx`, `.js`, and `.jsx` files into structured Markdown.
- Stores English at `.langclarity/<source-path-and-extension>.md`.
- Opens a focused interpretation pane with editable English Code and read-only supporting context.
- Detects whether code, English, or both changed since the last successful synchronization.
- Refreshes English from code only on **Code → English**.
- Proposes code from edited English on **English → Code**, shows the exact VS Code diff, validates syntax, and waits for explicit approval.
- Preserves both current files when a request fails or is cancelled.

LangClarity does not automatically merge independently changed code and English. When both changed, choose which side is authoritative.

## Requirements

- VS Code 1.134.0 or newer.
- A trusted workspace containing a saved, supported source file.
- Codex 0.148.0-alpha.15 or newer.
- Codex signed in with ChatGPT. Run `codex login` and complete the browser flow if needed.

The MVP is verified on macOS. It uses the Codex executable bundled with `/Applications/ChatGPT.app` when present; otherwise `codex` must be available on the extension host's `PATH`. Windows and Linux are not yet release-certified.

## Quick start

1. Open a project folder in VS Code.
2. Open a supported TypeScript or JavaScript source file.
3. Right-click the source in the editor or Explorer and open the **LangClarity** submenu. You can also use the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux.
4. Run **LangClarity: Open Interpretation**.
5. If no English file exists, choose **Interpret File**.
6. Review the provider disclosure, then continue.

The source and LangClarity interpretation pane open side by side. Its English Code tab is one editable, editor-like text surface with a left gutter containing every source line number. When synchronized, source line N and English row N are an exact pair, so both sides have the same number of logical lines. Generated English Code uses the shortest clear everyday wording, normally one clause per row. Parent rows and indentation carry context so child rows do not repeat subjects or identifiers. Readable fragments are allowed, while visible literal values remain verbatim and unavoidable technical terms are explained. Blank source lines produce blank English rows; no generated row summarizes, reorders, or absorbs another source line. Enter inserts an English row and shifts the current and following content and gutter positions down like a source-line insertion. The editor supports native selection, undo/redo, copy/paste and find behavior, two-space Tab/Shift+Tab indentation, clickable line numbers, active-line highlighting, synchronized scrolling, save shortcuts, and line/column status. Overview, Structure, and Effects provide higher-level read-only summaries. Edits update the backing Markdown text document and participate in normal save and undo behavior. The pane shows only the synchronization action valid for its current state, or a direction chooser when both representations changed; synchronized or invalid panes show no sync action. Use **Open Markdown** in the pane when you need to inspect or repair the raw file.

The source-file context menu and Command Palette hide actions that do not apply to the active file. A source without a paired document offers **Interpret File**; a source with one offers **Open Interpretation** and synchronization actions. Generic Markdown and unsupported files do not expose source synchronization commands. The LangClarity status-bar item reports the current synchronization state and is keyboard-accessible through VS Code's standard status-bar navigation.

To choose a model, run **LangClarity: Select Codex Model and Reasoning** from a supported source file. The selector contains only visible models returned by your local Codex runtime. The default is the current Codex default; `medium` is recommended for Code → English when the selected model supports it.

## Synchronization

- **Synced:** edit either representation.
- **Code changed:** run **LangClarity: Code → English** to replace stale English after a complete validated response.
- **English changed:** run **LangClarity: English → Code**, review the diff, then choose Apply or Cancel. After approval, LangClarity refreshes the complete interpretation from the proposed source and applies both documents together; every pane tab therefore describes the synchronized code.
- **Both changed:** activate the status item and choose an authoritative direction. Cancel leaves both files untouched.
- **Invalid English:** repair the malformed Markdown or restore the last valid file before synchronizing.

No AI request occurs merely because a source or cached English file is opened. LangClarity does not implement on-save, idle, debounce, or per-keystroke synchronization.

## Privacy and storage

Before the first model operation in a workspace, LangClarity discloses that the requested source and English are sent to Codex/OpenAI under the policies for your Codex account. The MVP has no LangClarity backend and does not route source through one.

LangClarity:

- does not request or store API keys, ChatGPT passwords, authentication cookies, or provider tokens;
- does not collect product telemetry;
- does not log source, English, prompts, responses, credentials, or full workspace paths;
- starts Codex in an isolated temporary runtime root with no approvals, disables known tool surfaces, and aborts if Codex reports a tool item;
- stores interpretations as ordinary Markdown in the current workspace.

LangClarity does not modify `.gitignore`. Decide with your team whether `.langclarity/` should be committed, because its Markdown may contain source-derived information.

Codex sign-in and account policy behavior are documented in the [official OpenAI authentication guide](https://learn.chatgpt.com/docs/auth).

## MVP limits

- Code → English and English → Code model operations accept source files up to 75 KiB and 2,000 lines.
- Model operations accept English documents up to 256 KiB where applicable.
- Existing interpretations remain openable and locally editable even when their source exceeds a model-operation limit.
- Structured runtime message: at most 2 MiB.
- Concurrent operations: one per file and two globally.
- Request timeout: three minutes.

Interpretations and code proposals are AI-generated and may be incomplete or incorrect. Review English claims and every proposed code diff. LangClarity guarantees neither semantic equivalence nor logical/type correctness.

Related-file and related-test mapping, additional language certification, automatic synchronization, and intelligent conflict merging are not included in this MVP.

## Troubleshooting

### Codex is not installed

Install or update Codex, then confirm that `codex --version` reports 0.148.0-alpha.15 or newer. On macOS, LangClarity also checks the Codex executable bundled with the ChatGPT desktop app.

### Sign-in is required

Run `codex login`, complete the browser flow, and retry the LangClarity action. LangClarity's MVP requires ChatGPT sign-in and does not ask for an API key.

### The command is not visible

Open or right-click a saved `.ts`, `.tsx`, `.js`, or `.jsx` file inside the current workspace. Supported source files expose a **LangClarity** context submenu; the Command Palette exposes **Open Interpretation** and model selection.

### The status does not update

Make sure the source/English pair has been opened through **LangClarity: Open Interpretation**. Open-document edits are detected immediately; external changes are detected after the filesystem write is observed.

### A proposal cannot be applied

Syntax errors block application. Other VS Code diagnostics require **Apply Anyway**. If code or English changed after proposal generation, generate a fresh proposal.

Use **View: Toggle Output** and select **LangClarity** for redacted operation categories. Logs intentionally exclude source and prompt content.

## Development

Run `npm install`, then `npm test`.

To launch the Extension Development Host without F5:

1. Open this repository folder in VS Code.
2. Open **Run and Debug**.
3. Select **Run Extension**.
4. Use the play button, or run **Debug: Start Debugging** from the Command Palette.

The `code` shell command is not required. To create an installable VSIX, run `npm run package:vsix`; then use **Extensions → Views and More Actions → Install from VSIX…**.
