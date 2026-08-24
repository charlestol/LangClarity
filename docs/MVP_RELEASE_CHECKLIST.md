# LangClarity MVP release checklist

## Automated release gate

Run from the repository root:

```sh
npm test
LANGCLARITY_LIVE_TEST=1 npm test
npm run package:vsix
```

The ordinary suite must pass without Codex authentication. The gated live smoke test must interpret and propose code through the local Codex runtime without changing its fixture. Packaging must produce a VSIX whose contents contain compiled extension code, runtime dependencies, README, changelog, and manifest, but exclude source tests, development configuration, protocol proof artifacts, and local workspace data.

## Manual acceptance certification

Use a fresh VS Code profile on a supported macOS system:

1. Install the generated VSIX through **Extensions → Views and More Actions → Install from VSIX…**.
2. Open a trusted fixture project and confirm that opening supported source makes no model request.
3. Interpret a source file, confirm the privacy disclosure, and verify the paired `.langclarity/` path.
4. Restart VS Code, reopen the English view, and confirm it loads without another request.
5. Edit English, generate a proposal, cancel once, then regenerate and apply after reviewing the exact diff.
6. Edit code and refresh English.
7. Change both sides and verify the authoritative-direction chooser and non-destructive cancel path.
8. Cancel an active request and verify both files are preserved.
9. Rename and delete a disposable source file; verify its English moves with the rename and is preserved under `.langclarity/.orphaned/` after deletion.
10. Select a runtime-returned model and reasoning effort, restart, and verify the workspace preference remains selected.
11. Try an unsupported extension and an over-limit fixture; verify clear non-destructive guidance.
12. Review the LangClarity output channel and confirm it contains categories and base filenames only, not source, English, prompts, responses, credentials, or full paths.

The repository uses the MIT license and advertises `https://github.com/charlestol/LangClarity`. Public Marketplace release additionally requires ownership of the `langclarity` publisher identifier. Do not invent or substitute that identity merely to bypass publishing requirements.

## Deferred certification

- Exercise Codex login initiation and cancellation from a genuinely signed-out account.
- Test rejection with an actual older Codex binary, in addition to version-comparison fixtures.
- Inject malformed data through a live protocol stream, in addition to client-boundary fixtures.
- Certify Windows and Linux before describing them as supported platforms.
- Related-file/test mapping remains omitted because it is optional enrichment and has not yet met a precision/reviewability gate.

## Pilot feedback plan

Start with a small internal group using representative TypeScript and JavaScript files. Ask participants to complete initial interpretation, reopen, English → Code, Code → English, and both-changed workflows. Collect only explicitly consented feedback; do not collect source, English, prompts, or responses through product telemetry.

Record qualitative usefulness, incorrect or unsupported English claims, proposal rewrite size, apply/cancel decisions, recurring failures, and whether participants voluntarily reopen or edit English later. Establish baseline variance before choosing numeric adoption or quality thresholds. Stop the pilot for any reproducible data-loss, credential, source-routing, or silent-apply issue.
