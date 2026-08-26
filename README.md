# LangClarity

LangClarity is a preview VS Code extension that gives TypeScript and JavaScript files a persistent, editable structured-English representation. Code and English are ordinary workspace files; synchronization runs only when you choose a direction.

## Features

- Interprets `.ts`, `.tsx`, `.js`, and `.jsx` into structured Markdown at `.langclarity/<source-path>.md`.
- Keeps English paired on rename/move; orphans deleted sources to `.langclarity/.orphaned/`.
- Opens an interpretation pane with editable English Code and read-only summaries.
- Detects whether code, English, or both changed since the last sync.
- **Code → English** refreshes English from code.
- **English → Code** proposes code from edited English, shows the diff, validates syntax, and waits for approval.
- Preserves both files when a request fails or is cancelled.

When both sides changed independently, pick which is authoritative—LangClarity does not auto-merge.

## Requirements

- VS Code 1.134.0+
- Trusted workspace with a saved supported source file
- Codex 0.148.0-alpha.15+ signed in via ChatGPT (`codex login`)

Verified on macOS (uses ChatGPT.app's bundled Codex when present, otherwise `codex` on `PATH`). Windows and Linux are not yet release-certified.

## Getting started

1. Open a trusted workspace and a saved `.ts`, `.tsx`, `.js`, or `.jsx` file.
2. **Right-click** the source in the editor or Explorer → **LangClarity**.
3. Choose **Interpret File** to create the English pair and open the interpretation pane. If a pair already exists, choose **Open Interpretation** instead.
4. Review the provider disclosure on first use, then edit English or sync.

The source and interpretation pane open side by side. **English Code** is editable with source line numbers in a gutter; **Overview**, **Structure**, and **Effects** are read-only summaries. Sync state appears in the pane and status bar.

**Right-click → LangClarity** is the main entry point for interpretation, sync, and **Select Codex Model and Reasoning**. When only one sync action applies, the pane also shows a suggested-action button. Click the status bar when it offers a sync command (for example, when both sides changed). **Open Markdown** in the pane opens the raw `.langclarity` file beside the source.

The Command Palette exposes the same commands when they apply to the active file; use it if you prefer keyboard-driven workflows.

## Synchronization

| State | Action |
| --- | --- |
| Synced | Edit either side freely |
| Code changed | **Code → English** (right-click, pane button, or status bar) |
| English changed | **English → Code** → review diff → Apply or Cancel |
| Both changed | **Choose Apply Direction…** from the pane or status bar, or pick a direction from the right-click menu |
| Invalid English | Repair the Markdown file before syncing |

No AI request runs on open, save, idle, or keystroke.

## Privacy and storage

Before the first model operation, LangClarity discloses that requested source and English are sent to Codex/OpenAI under your account's policies. There is no LangClarity backend.

LangClarity does not store API keys, collect telemetry, or log source, prompts, or full paths. Codex runs in an isolated temp root with tools disabled. Interpretations live as ordinary Markdown in the workspace.

After the first interpretation, LangClarity can add `/.langclarity/` to `.gitignore`—only if you choose **Add to .gitignore**. Decide with your team whether to commit `.langclarity/` (it may contain source-derived content).

Sign-in details: [OpenAI authentication guide](https://learn.chatgpt.com/docs/auth).

## MVP limits

- Source: up to 75 KiB / 2,000 lines per model operation
- English: up to 256 KiB where applicable
- Existing pairs remain openable locally even when over limits
- One operation per file, two globally; 3-minute timeout

AI output may be incomplete or incorrect—review English claims and every proposed diff. Related files lists direct imports only. No auto-sync, conflict merging, or multi-hop related files in this MVP.

## Troubleshooting

| Issue | Fix |
| --- | --- |
| Codex not installed | Install Codex ≥ 0.148.0-alpha.15; verify with `codex --version` |
| Sign-in required | Run `codex login`, complete browser flow, retry |
| LangClarity menu missing | Right-click a saved `.ts`/`.tsx`/`.js`/`.jsx` in the editor or Explorer |
| Status stale | Right-click the source → **LangClarity** → **Open Interpretation** |
| Proposal blocked | Fix syntax errors, or **Apply Anyway** for other diagnostics; regenerate if files changed since proposal |

Output: **View: Toggle Output** → **LangClarity** (redacted categories only).
