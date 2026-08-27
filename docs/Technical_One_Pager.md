# LangClarity Technical One-Pager — Implementation Reference

## 1. Purpose and status

This document turns the requirements in [PRD.md](./PRD.md) into the deeper implementation reference for module responsibilities, state and data contracts, workflows, delivery phases, risks, and verification. [High_Level_Tech_Doc.md](./High_Level_Tech_Doc.md) remains the concise architecture map.

**Status:** the VS Code extension MVP is largely implemented. Claims below describe shipped behavior unless marked as open/future work. Phase 0 (Codex protocol proof) passed on 2026-08-22 with Codex CLI `0.148.0-alpha.15` (stdio initialization, existing-account detection, dynamic model enumeration, schema-valid turns in both directions, cancellation, restart, missing-runtime handling, and zero-write checks in a disposable fixture). The app-server is still experimental, so generated protocol contracts and a minimum-version gate remain mandatory. Remaining release-owner gates are tracked in [MVP_RELEASE_CHECKLIST.md](./MVP_RELEASE_CHECKLIST.md).

## 2. Design principles

1. **Validate the thesis, not a theoretical compiler.** Use an LLM, useful syntax/AST context, persistent English, and explicit synchronization.
2. **Keep source editing native.** Source remains an ordinary VS Code document; do not recreate an editor or language service.
3. **Make AI writes reviewable.** Codex returns a proposal. It never writes source directly.
4. **Commit state only after complete success.** Model, validation, preview, or apply failures must preserve both representations.
5. **Treat external edits as normal.** VS Code, Git, extensions, and filesystem tools may all change source.
6. **Keep abstractions proportional to MVP.** Isolate Codex behind two operations, but do not build a provider marketplace or semantic IR.
7. **Prefer inspectable files over hidden state.** The Markdown under `.langclarity/` is the English representation and is readable by developers and filesystem-capable agents.
8. **Keep English Code line-aligned.** When synchronized, source line N and English row N are an exact pair. Stable AST identity is not required.

## 3. Assumptions and decisions to validate

### 3.1 Assumptions

- MVP runs as a desktop VS Code extension with access to a local Codex runtime. VS Code for the Web is not targeted.
- “TypeScript and JavaScript” provisionally includes `.ts`, `.tsx`, `.js`, and `.jsx`; narrowing this to `.ts` and `.js` changes eligibility and parser configuration, not the design.
- One source file has at most one Markdown interpretation in its owning workspace folder.
- Source `src/users.ts` maps to `.langclarity/src/users.ts.md`. Retaining the source extension prevents `.ts`/`.js` basename collisions.
- Source uses the native VS Code text editor. English UX is a custom text editor plus webview (`langclarity.interpretationView`). Native Markdown remains available as a secondary surface via `langclarity.openMarkdown`.
- `.langclarity/` is ordinary workspace content. LangClarity does not silently commit or ignore it; after the first interpretation, the user may explicitly add it to `.gitignore`.
- A full proposed source document is the simplest reliable internal contract for English → Code, even if Codex returns a patch. The proposal coordinator always materializes the exact final document before validation and preview.

### 3.2 Phase 0 findings

The executable proof established:

1. Codex `0.148.0-alpha.15` supports stdio app-server startup, `initialize`, `account/read`, `model/list`, `thread/start`, `turn/start`, structured `outputSchema`, and `turn/interrupt` for the tested authenticated account.
2. `model/list` returned six visible models with default flags and supported reasoning efforts. This is a runtime snapshot, not a catalog to hard-code.
3. Both directions returned schema-valid data while the read-only/no-approval fixture remained byte-for-byte unchanged; cancellation and restart also passed.
4. Missing-executable, stale-response, malformed-protocol, and malformed-result guards passed at the client boundary. An older-version rejection passed with a simulated version string.
5. Login initiation/cancellation was not exercised because the account was already authenticated. That remains open certification work, not a Codex integration blocker.
6. Schema validity did not guarantee semantic fidelity: the first Code → English response contained an internal input-mutation contradiction.

If Codex cannot be invoked through an official supported local interface with Codex-managed ChatGPT authentication, that is an MVP-blocking integration finding and requires a product decision. It must not be silently replaced with API-key auth.

## 4. System context

```text
┌──────────────────────────── VS Code Extension Host ───────────────────────────┐
│                                                                              │
│  Commands/status ── Interpretation webview ── Session coordinator ─ Source   │
│                          │                         │                  │       │
│                   .langclarity Markdown            ├── State          ├── Parser
│                   (openMarkdown secondary)         ├── Facts          ├── Validator
│                                                    └── Proposals      └── Diff/apply
│                                                          │                   │
└──────────────────────────────────────────────────────────┼───────────────────┘
                                                           │ local protocol
                                                           ▼
                                                 Codex runtime/app-server
                                                           │
                                                           ▼
                                           Codex-managed ChatGPT authentication
                                                           │
                                                           ▼
                                                      OpenAI/Codex
```

No LangClarity service is in the inference or authentication path. Interpretations remain as local Markdown in the workspace’s `.langclarity/` tree; the primary English UX is the custom interpretation editor over that file.

## 5. Major components

### 5.1 Extension entry point

Responsibilities:

- register commands, view providers, and status UI;
- construct services and dispose resources;
- enforce workspace trust and supported-document prerequisites;
- route user actions to the correct file session.

Keep this layer thin. Business state belongs in the session coordinator.

### 5.2 English document view

Primary English UX is the custom editor `langclarity.interpretationView` (CustomTextEditor + webview) registered for `**/.langclarity/**/*.md`. Open it beside the source with Open Interpretation. Native Markdown remains a secondary surface via **Open Interpretation Markdown** (`langclarity.openMarkdown`).

Responsibilities:

- present editable Behavior rows and sync actions in the webview while persisting the same `.langclarity/` Markdown document;
- retain undo/redo through the underlying text document, plus Git/filesystem access to that Markdown;
- expose synchronization through commands, editor/title or pane actions, and status items (no CodeLens in MVP);
- validate required metadata/headings only when a sync is requested;
- keep current Markdown intact when validation or interpretation fails.

The Markdown file under `.langclarity/` is the durable source of truth for English. There is no duplicate English buffer in extension storage. The webview is the primary editing surface; native Markdown is not the default English UX.

### 5.3 File session coordinator

One in-memory session coordinates each open English/source pair.

Responsibilities:

- load the paired Markdown and current source;
- compute hashes and derive sync state;
- serialize model operations per file;
- stage results and reject stale responses;
- publish state to VS Code status/actions;
- write accepted Code → English results atomically to the paired Markdown file;
- coordinate conflict choices, validation, diff preview, and apply.

Do not allow simultaneous Code → English and English → Code operations for the same source file. Sessions for unrelated files may operate independently if Codex supports it safely, but concurrency is not required for MVP.

### 5.4 Source document adapter

Responsibilities:

- read exact current source text from VS Code;
- observe open-document changes and filesystem-backed changes;
- apply approved edits through `WorkspaceEdit` or an equivalent VS Code API;
- track the base document version/hash of proposals;
- identify extension-originated applies and avoid feedback loops;
- expose the correct language ID and URI.

The adapter does not maintain a second source buffer beyond a temporary proposed document.

### 5.5 Language service

Use the TypeScript compiler API for TypeScript/JavaScript syntax handling. Reuse VS Code diagnostics where practical for post-proposal warnings.

Responsibilities:

- choose the script kind from the supported document;
- parse source and report syntax errors;
- optionally extract coarse context such as functions, classes, declarations, and source ranges;
- resolve direct import/export module references into local `RepositoryFacts` (`keyDefinitions`, `dependencies`, `relatedFiles`);
- leave `relatedTests` empty in MVP (no test discovery);
- collect relevant diagnostics after a syntactically valid proposal.

AST context is advisory input and mapping metadata, not a persistent semantic model. Incomplete current code may be submitted best-effort when useful; an unparseable proposed document is not ordinarily applicable. Multi-edge dependency graphs, heuristic candidates, and connected-file English summaries are not implemented.

### 5.6 Interpreter boundary

MVP exposes only the operations it needs:

```ts
interface Interpreter {
  codeToEnglish(input: CodeToEnglishInput): Promise<CodeToEnglishOutput>;
  englishToCode(input: EnglishToCodeInput): Promise<EnglishToCodeOutput>;
}

interface CodeToEnglishOutput extends ModelResolution {
  document: InterpretationResult; // purpose, responsibilities, behavior, sideEffects, constraints
}

interface EnglishToCodeOutput extends CodeChangeResult, ModelResolution {}

interface CodeChangeResult {
  proposedSource: string;
  summary: string; // required
}
```

`CodexInterpreter` is the only production implementation. The interface isolates process/protocol details for testing and future replacement. MVP includes model selection only from models enumerated by the authenticated Codex runtime; it does not include provider selection or a generic capability system.

`codeToEnglish` returns model fields only (`InterpretationResult` via `document`). Locally derived `RepositoryFacts` are computed separately and merged when rendering Markdown; they are not part of the interpreter return value.

Responsibilities:

- connect to or start the supported Codex runtime;
- report runtime and Codex-managed auth failures through error classes (`AuthenticationRequiredError`, `UsageLimitedError`, `CodexResponseError`) rather than a documented `CodexStatus` union;
- enumerate non-hidden models and their supported reasoning efforts;
- construct bounded prompts containing source, structured English, and direction-specific instructions;
- request schema-conforming responses;
- validate response shape and pass Codex error messages through without parsing or reclassification;
- support cancellation when exposed by the runtime and enforce LangClarity's own turn timeout (180s).

Codex output is untrusted data. It is schema-checked and staged before use.

### 5.7 Markdown repository

Use `.langclarity/` inside each workspace folder as the persistence mechanism. A source-relative path maps deterministically to the same relative path plus `.md` while retaining the source extension.

Responsibilities:

- map source and English URIs without a repository-wide index;
- parse and render versioned frontmatter plus predictable Markdown sections;
- compute source, editable-English, and mapping revision hashes;
- preserve user edits and isolate malformed documents to their source file;
- move paired documents with source renames and preserve deleted-source documents in an orphaned area;
- avoid storing secrets or runtime credentials.

### 5.8 Proposal and diff coordinator

Responsibilities:

- convert a Codex response into an exact full proposed source document;
- ensure the proposal is based on the current source and English document hashes;
- run syntax validation and collect proposal diagnostics;
- expose the proposal through VS Code’s diff UI using an in-memory/virtual document;
- after the user chooses Apply / Apply Anyway, wait for a second Code → English refresh of the proposed source, then apply proposed source and refreshed Markdown together in one `WorkspaceEdit` (`proposalCoordinator.ts`);
- dispose temporary proposal state on apply, cancellation, error, or source divergence.

### 5.9 Logging

Use a LangClarity output channel for operational events and coarse error sources (`codex` or `langclarity`).

Default logs may include:

- command and operation names;
- session/file key hashed or reduced to a non-sensitive display name;
- state transitions;
- timings, response sizes, validation counts, and error categories.

Default logs must not include source text, English text, prompts, model output, ChatGPT tokens, credentials, or full sensitive paths. Any future diagnostic-content logging must be explicit opt-in with a clear preview.

## 6. Codex runtime and authentication

### 6.1 Intended flow

```text
User requests interpretation
  → detect/connect to Codex runtime
  → query runtime/auth status
  → if unauthenticated, request Codex-managed login
  → Codex opens its supported browser/provider flow
  → Codex owns credentials and refresh state
  → extension submits structured request
```

LangClarity must not:

- receive or store a ChatGPT password;
- implement generic “Sign in with ChatGPT” OAuth;
- read or manipulate Codex token storage;
- request an OpenAI API key;
- substitute hosted LangClarity inference.

### 6.2 Runtime states and operation failures

There is no implemented `CodexStatus` union driving the UI. Account/runtime problems surface as thrown errors while model work uses `vscode.window.withProgress` (cancellable notifications) plus status-bar sync state from the session coordinator.

```ts
// Session document sync (sessionCoordinator.ts)
type StableSyncState =
  | "SYNCED"
  | "CODE_CHANGED"
  | "ENGLISH_CHANGED"
  | "BOTH_CHANGED";

type SessionState = StableSyncState | "ERROR";
// No INTERPRETING overlay — in-flight work is shown via withProgress / pendingSources.

// Codex / account failures (codexInterpreter.ts)
class CodexResponseError extends Error {
  willRetry?: boolean;
}
class AuthenticationRequiredError extends CodexResponseError {}
class UsageLimitedError extends CodexResponseError {}
```

For any failure returned by Codex, use its returned message verbatim for the user-facing `codex` error category. Do not branch on, regex-match, translate, or maintain product copy for Codex message text. If Codex supplies no usable message, use a generic unknown-Codex-error fallback. Structured Codex details may be retained for redacted diagnostics, but MVP product behavior does not depend on them. `willRetry`, when supplied by Codex, controls only whether the progress UI reports that Codex is retrying.

LangClarity-originated errors cover conditions the extension detects itself, including missing/incompatible runtime, process startup or exit, local timeout, invalid protocol data, workspace access, and source access. Cancellation is not an error; authentication required and usage limited are explicit subclasses of `CodexResponseError`.

The extension should start/connect only after a LangClarity action requires Codex. Ordinary file opening must not cause login, process startup, or inference.

### 6.3 Process and protocol safety

- Launch only the expected executable with argument arrays, never concatenated shell input.
- Generate or verify protocol types against the minimum supported Codex version and reject incompatible versions with setup guidance. The app-server interface is experimental and must not be assumed stable.
- Bound request size, response size, and operation duration.
- Parse framed/structured output; do not infer success from arbitrary stdout prose.
- Treat Codex error messages as opaque display text rather than a stable classification API.
- Separate protocol messages from diagnostic stderr.
- Dispose child processes/connections when VS Code deactivates where ownership requires it.
- Start each client in a fresh isolated temporary runtime root, use a read-only sandbox with no approval requests, disable known tool surfaces at launch and thread scope, and abort if the protocol reports a tool item. Codex receives the requested source and English in the prompt and returns proposals but does not edit files.
- Treat Markdown and model output as untrusted text. Do not enable executable Markdown content or trust model-supplied file relationships.

### 6.4 Model selection

The selector starts with **Codex default (recommended)** and then displays only non-hidden models returned by `model/list`. Do not hard-code a model catalog. For Code → English, recommend `medium` reasoning when the selected model reports it as supported; users may choose another returned effort. Otherwise use the model default.

Store the chosen model ID as a workspace preference. If it disappears, becomes unavailable, or model enumeration fails, notify the user and fall back to the current Codex default. Model selection is available only after the runtime is ready and must never bypass account entitlements.

## 7. English representation

### 7.1 User-facing Markdown

English is concise and program-like. Headings and list indentation express hierarchy, and order follows source logic. Major function/class identity and important identifiers are retained when useful.

Example:

```md
---
schemaVersion: 1
source: src/users.ts
sourceHash: sha256:...
editableEnglishHash: sha256:...
mappingRevisionHash: sha256:...
languageId: typescript
promptVersion: 7
model: codex-default
interpretedAt: 2026-08-22T00:00:00Z
---

# `src/users.ts`

## Purpose

Select the highest-scoring active US users.

## Responsibilities

- Retrieve users.
- Filter by active status and US location.
- Sort by score, highest first.
- Return the first 10.

## Behavior

1. Make `getTopUsers` available to other files. _(1–1)_
2. Ask `getUsers` for the users and remember the result. _(2–2)_
3. Keep only people whose active setting is exactly `true` and whose country is exactly "US". _(3–3)_
4. Give back the first 10 matching people. _(4–4)_

## Key definitions
## Dependencies
## Related files
## Related tests
## Side effects
## Constraints
```

Frontmatter always includes `editableEnglishHash`; `mappingRevisionHash` is written when local repository facts are rendered. Section headings are versioned. Empty sections are permitted when the source provides no supported facts. The document remains useful as ordinary Markdown even when the extension is absent.

### 7.2 Structured contract

LangClarity composes the document from a validated model response and locally derived facts, then renders it into Markdown. The model response (`InterpretationResult`) supplies purpose, responsibilities, behavior, side effects, and constraints. Source identity, key definitions, dependencies, related files, and related tests come from local analysis (`RepositoryFacts`) and frontmatter — not from the interpreter return value.

```ts
interface InterpretationResult {
  purpose: string;
  responsibilities: string[];
  behavior: EnglishCodeLine[];
  sideEffects: string[];
  constraints: string[];
}

interface EnglishCodeLine {
  sourceLine: number;
  statement: string;
}

interface RepositoryFacts {
  keyDefinitions: string[];
  dependencies: string[];
  relatedFiles: string[]; // direct imports only in MVP
  relatedTests: string[];  // always [] in MVP
}

interface CodeToEnglishOutput extends ModelResolution {
  document: InterpretationResult;
}
```

The rendered Markdown document is the persisted form; there is no separate persisted `EnglishDocument` object graph with `VerifiedRelationship` kinds.

Validation rules:

- `behavior` contains exactly one item per submitted source line;
- item N has `sourceLine: N`, with no gaps, duplicates, combinations, or reordering;
- statements are bounded single-line text, and blank or punctuation-only structural source lines use empty statements;
- each nonblank statement explains only its paired source line in everyday language and preserves visible literal values verbatim;
- multiline declarations use their opening row for shared purpose while retaining each meaningful element or property and its visible value on its own row;
- line correspondence improves inspectability but never proves correctness or authorizes edits by itself.

Line identity is positional and recalculated when synchronization succeeds. MVP does not require stable AST-node identity across edits or regenerations.

Locally generated sections use explicit HTML comment boundaries. They are excluded from the editable-English hash so deterministic refreshes do not incorrectly produce `ENGLISH_CHANGED`:

```md
<!-- langclarity:generated:start relationships -->
...
<!-- langclarity:generated:end relationships -->
```

### 7.3 Connected-file discovery

MVP connected-file context is intentionally small (`repositoryFacts.ts`):

1. Parse the source with the TypeScript compiler API and collect direct import/export module specifiers.
2. Resolve those specifiers with compiler options from the nearest `tsconfig`/`jsconfig` when available.
3. Workspace-relative resolved paths (excluding `node_modules`) become `dependencies` evidence strings and `relatedFiles` entries labeled as directly imported.
4. Do **not** traverse multi-edge paths, label heuristic candidates, or attach connected files’ English summaries.
5. Recompute these local facts on interpretation/render; this does not invoke Codex.

This is a direct-import map for the Related files section, not a repository-wide semantic graph.

### 7.4 Related-test discovery

Related-test discovery is **not shipped**. `RepositoryFacts.relatedTests` is always `[]`, and the Related tests Markdown section renders as none verified. Optional inventory via `findFiles`, convention matching, Playwright/Cypress config, or static paths from tests remains deferred future work — not part of the implemented MVP.

### 7.5 Model instructions

Code → English requests should instruct Codex to:

- preserve logical hierarchy, ordering, and control flow;
- return exactly one ordered Behavior item per numbered source line, with the same line number;
- explain only that source line in language an everyday person can understand as easily as possible;
- use the shortest unambiguous wording, normally one clause and roughly 12–18 words excluding required literals;
- let parent rows and indentation carry context, allow readable fragments, and omit repeated subjects or identifiers when context remains clear;
- preserve visible strings, numbers, booleans, property names, event names, URLs, log labels, and other known values verbatim;
- lead with everyday meaning, explain unavoidable technical terms, and mention identifiers only when useful for exact correspondence;
- use familiar plain-English control-flow phrases while avoiding formal pseudocode keywords, arrows, symbolic operators, vague summaries, and programming syntax as sentence structure;
- use two-space indentation to represent nested control flow;
- avoid generic narrative prose;
- include useful identifiers;
- represent functions/classes recognizably;
- make only claims supported by the submitted source and prefer omission when uncertain;
- distinguish mutation of inputs from mutation of temporary or copied values;
- check behavior, side effects, and constraints for contradictions before returning;
- use an empty statement for each blank or punctuation-only structural source line;
- return only the required structured result.

LangClarity derives source path/hash, key definitions, dependencies, and direct related files locally. These deterministic facts may be supplied as context or rendered into generated Markdown sections, but they are not delegated to unconstrained model output. Related tests are not discovered in MVP.

The POC uses one interpretation call. Do not add a second critic/review call until repeated corpus measurements show that it materially improves semantic fidelity enough to justify the additional latency and usage.

English → Code requests should include current source, current English, the last synchronized English snapshot when useful, and coarse mappings. They should instruct Codex to preserve unrelated code and return the smallest practical change.

Prompt/schema versions are stored with records for troubleshooting and migration. Prompt text itself need not be persisted per file.

## 8. Data model

The following is the likely MVP model. Exact TypeScript names may change, but the information and invariants should remain small.

### 8.1 Persisted interpreted file

The Markdown file is the persisted record. Its frontmatter contains only the metadata needed to derive state and reproduce the interpretation:

```ts
interface InterpretationFrontmatter {
  schemaVersion: 1;
  source: string;
  sourceHash: string;
  editableEnglishHash: string;
  mappingRevisionHash?: string;
  languageId: "typescript" | "typescriptreact" | "javascript" | "javascriptreact";
  promptVersion: string;
  model: string;
  interpretedAt: string;
}
```

The Markdown body is the current editable English and is not duplicated in `workspaceState`. `editableEnglishHash` is the last synchronized baseline of user-editable sections. `mappingRevisionHash` covers the deterministic local repository facts rendered in the generated relationship section. While a pane is open, LangClarity recomputes those facts after relevant workspace source changes and compares their hash with this baseline. A mismatch produces an independent `STALE` repository-context status and an explicit local refresh action. Updating generated evidence alone does not change editable synchronization state or invoke Codex.

`workspaceState` may hold non-content preferences such as the selected model and dismissed notices. It must not become a hidden second copy of English.

### 8.2 Runtime session

```ts
interface FileSession {
  id: string;
  sourceUri: string;
  sourceDocumentVersion?: number;
  currentSourceHash: string;
  englishUri: string;
  currentEnglishHash: string;
  baselineSourceHash: string;
  baselineEnglishHash: string;
  state: SessionState;
  pending?: PendingOperation;
  error?: SessionError;
}
```

Implemented session state is `StableSyncState | "ERROR"` (`sessionCoordinator.ts`). In-flight model work is tracked with `pendingSources` and shown via `withProgress`, not an `INTERPRETING` session state.

### 8.3 Synchronization state

```ts
type StableSyncState =
  | "SYNCED"
  | "CODE_CHANGED"
  | "ENGLISH_CHANGED"
  | "BOTH_CHANGED";

type SessionState = StableSyncState | "ERROR";
```

There is no `INTERPRETING` value. Operation progress overlays the derived stable state through VS Code progress notifications; `ERROR` covers invalid/unreadable paired Markdown. Cancellation or failure leaves the last derived stable state (or `ERROR` if the Markdown remains unusable).

### 8.4 Pending operation

```ts
interface PendingOperation {
  operationId: string;
  direction: "CODE_TO_ENGLISH" | "ENGLISH_TO_CODE";
  baseSourceHash: string;
  baseEnglishHash: string;
  startedAt: string;
}
```

Every asynchronous response is accepted only when its operation ID and both base hashes still match the active operation. Otherwise it is discarded as stale.

### 8.5 Proposed code change

```ts
interface CodeChangeResult {
  proposedSource: string;
  summary: string; // required by schema and validateCodeChangeResult
}

interface ProposedCodeChange {
  id: string;
  sourceUri: string;
  baseSourceHash: string;
  baseEnglishHash: string;
  proposedSource: string;
  proposedSourceHash: string;
  syntaxErrors: ValidationIssue[];
  diagnostics: ValidationIssue[];
}
```

Keep proposals in memory. Persisting abandoned AI output creates recovery and privacy complexity without an MVP need.

### 8.6 Hashing and canonicalization

- Hash the exact source text seen by VS Code with SHA-256.
- Hash a deterministic parse/serialization of user-editable English sections. Exclude frontmatter fields and generated-section bodies.
- Hash the deterministic repository facts rendered in the generated relationship section separately as `mappingRevisionHash`.
- Do not trim or normalize source before hashing; whitespace edits still make cached English stale.
- Define one canonical Markdown parser/renderer and cover round trips with fixtures. A render/parse round trip must not silently lose user text.

## 9. State derivation and transitions

### 9.1 Derivation

For a session with a synchronized baseline:

```ts
const codeChanged = currentSourceHash !== baselineSourceHash;
const englishChanged = currentEnglishHash !== baselineEnglishHash;

if (!codeChanged && !englishChanged) return "SYNCED";
if (codeChanged && !englishChanged) return "CODE_CHANGED";
if (!codeChanged && englishChanged) return "ENGLISH_CHANGED";
return "BOTH_CHANGED";
```

This deterministic derivation is preferred to manually mutating a complex state machine. Operation progress and errors overlay the derived stable state.

### 9.2 State transition table

| Event | Precondition | Result |
| --- | --- | --- |
| Open valid cache, hashes equal | Stored record exists | `SYNCED` |
| Open cache, source hash differs | Stored record exists | `CODE_CHANGED` |
| User edits English | Any stable state | Re-derive; usually `ENGLISH_CHANGED` or `BOTH_CHANGED` |
| Source changes | Any stable state | Re-derive; usually `CODE_CHANGED` or `BOTH_CHANGED` |
| Start directional sync | No pending operation for that source; conflict choice resolved | Progress notification; stable state unchanged until success/failure |
| Operation fails/cancels | Pending operation matches | Keep prior stable state (or `ERROR` if Markdown unusable) and show error/cancel outcome |
| Code → English succeeds | Base source still current | Replace English and both baselines; `SYNCED` |
| English → Code proposal succeeds | Both bases still current | Remain pending review; stable state unchanged |
| Proposal applied | Bases still current; proposed-source Code → English refresh succeeds | Apply proposed source + refreshed Markdown in one `WorkspaceEdit`; `SYNCED` |
| Proposal cancelled | Proposal exists | Discard proposal; return to prior stable state |

### 9.3 Both-changed authority

`BOTH_CHANGED` is not merged.

- Choosing Code → English means current code wins; current unsynchronized English will be replaced after successful interpretation.
- Choosing English → Code means current English wins; current code is still preserved until the developer reviews and applies the proposal.
- A warning precedes the model call. If the operation fails or is cancelled, neither side is replaced.

## 10. Detailed flows

### 10.1 Open English view

1. Resolve the active source document and verify support.
2. Resolve its owning workspace folder and paired `.langclarity/` Markdown URI.
3. Create or focus its session and open the custom interpretation editor (`langclarity.interpretationView`) beside the source if Markdown exists.
4. Read exact current source and compute its hash.
5. If no Markdown exists, offer **Interpret File**. Do not create a placeholder or contact Codex merely from opening source.
6. If Markdown exists, parse its metadata/body and derive state.
7. If the source hash differs, keep the interpretation visible as stale and expose Code → English.
8. Optionally open the underlying Markdown with `langclarity.openMarkdown` for native editing/review.

### 10.2 Initial Code → English

1. User selects **Interpret File**.
2. Re-read source and enforce supported language and size limits.
3. Ensure Codex is available and authenticated, using Codex’s login flow if required.
4. Capture source hash and operation ID; set progress overlay.
5. Optionally parse coarse syntax context; parsing failure may produce a best-effort request.
6. Send bounded source/context and the structured output schema.
7. Validate the entire response, exact line count, and consecutive source-line numbers.
8. Confirm operation ID and source hash still match.
9. Render a complete Markdown document to a temporary/in-memory value, recheck the source base, and write it to the paired path.
10. Open/publish the Markdown document and `SYNCED` state.

If any step fails, preserve the existing Markdown and current unsaved editor edits.

### 10.3 Refresh Code → English

The refresh flow matches initial interpretation, with two additions:

- If English also changed, require the both-changed authority warning first.
- Do not clear or overwrite current English until a complete structured response has passed validation and the source base is still current.

### 10.4 English → Code proposal

1. User requests English → Code. If code also changed, require the authority warning.
2. Capture current source, English, hashes, and operation ID.
3. Ensure Codex is ready.
4. Send current source and structured English, requesting a minimal code change and a structured result (`proposedSource` + required `summary`).
5. Convert the result to one exact proposed source document.
6. Reject an empty, malformed, over-limit, or wrong-language result.
7. Reject the result if either captured base changed while awaiting Codex.
8. Parse the proposal. Syntax errors block apply and are displayed; the proposal is discarded after the error message.
9. Collect proposal diagnostics from VS Code on the virtual proposal document (errors and warnings).
10. Register a read-only virtual document and show the VS Code diff against current source.
11. If diagnostics are present, offer only **Apply Anyway** / **Cancel**. If none, offer **Apply** / **Cancel**. There is no plain **Apply** when diagnostics are present.
12. On apply choice, wait for the in-flight Code → English refresh of the proposed source (see §10.5).

The diff must show exactly the content that would be applied to source. Do not generate a new English → Code response after preview without opening a new proposal.

### 10.5 Apply proposal

1. Re-check current source and English document hashes against the proposal bases.
2. If either differs, reject the apply and ask the user to regenerate; never patch onto an unknown base.
3. Await the second Code → English refresh started for the proposed source (`refreshEnglish` in `proposalCoordinator.ts`), shown as a cancellable progress notification. Validate that the refreshed Markdown frontmatter matches the proposed source hash and expected source path/language.
4. Re-check bases again after the refresh completes.
5. Build one `WorkspaceEdit` that replaces the source change and the full English Markdown with the refreshed interpretation, then `applyEdit`. Do not write through raw filesystem APIs and do not auto-save.
6. Verify the source document’s resulting exact hash matches the proposed source hash. Preserve EOL style, BOM/encoding behavior, and unrelated final-newline state; do not invoke formatting.
7. Reload the session and require `SYNCED`. Clear proposal/pending state.

If application, refresh, or verification fails, do not treat the pair as newly synchronized. The approved application is one undoable editor operation covering source and English, and the user remains responsible for saving both documents.

## 11. Diff generation and validation

### 11.1 Proposal form

Ask Codex for a structured full-source result (`proposedSource` + required `summary`). Internally always materialize a full proposed document. This simplifies:

- syntax parsing;
- diff preview;
- stale-base checks;
- exact apply verification;
- failure atomicity.

### 11.2 Syntax validation

Use the TypeScript compiler API with the correct script kind. A proposed `.ts`/`.tsx` file with parse diagnostics is invalid. For JavaScript, parse diagnostics are treated equivalently.

Syntax-invalid proposals may be viewed for troubleshooting but do not get **Apply** or **Apply Anyway**; after the error message the proposal is discarded.

### 11.3 Type/language diagnostics

After syntax succeeds, collect diagnostics from VS Code on the proposal document (`getDiagnostics`, errors and warnings). Because projects may already contain errors and model output is not guaranteed type-correct:

- diagnostic warnings do not hard-block MVP apply, but they change the action set;
- the UI states the relevant count and affected lines;
- with diagnostics present, the only choices are **Apply Anyway** and **Cancel** (no plain **Apply**);
- without diagnostics, choices are **Apply** and **Cancel**.

MVP uses proposal diagnostics only; newly-introduced-vs-baseline comparison is not implemented.

## 12. File-change detection and loop prevention

Listen for VS Code text-document changes, workspace create/delete/rename events, and file watcher events for paired source/Markdown documents.

Rules:

- Recompute the source hash from current text and derive state; never assume all change events are user edits.
- Debouncing hash computation for rapid local edits is allowed because it does not invoke AI or alter content.
- An extension apply records `{uri, operationId, expectedHash}` before calling the edit API.
- Matching document-change events are still observed, but the expected result is finalized as the same apply rather than starting another sync.
- Unexpected content or an interleaved user edit invalidates the proposal and re-derives state.
- No source-change event automatically starts Codex.
- Generated relationship section updates carry an extension-origin token and do not create `ENGLISH_CHANGED` because those sections are excluded from the editable hash.
- Direct-import `RepositoryFacts` are recomputed when interpretations are rendered; there is no separate watcher-driven related-test inventory.

For Git checkout or disk changes while an unsaved document exists, follow VS Code’s document model; do not bypass its conflict handling by reading and writing the disk directly.

### 12.1 Paired-file lifecycle

- **Create:** creating source does not create English until the user explicitly interprets it.
- **Rename/move:** when VS Code reports a source rename, move the paired Markdown to the new one-to-one path, create parent directories as needed, and update its `source` metadata and locally generated paths without an AI call.
- **Delete:** do not silently destroy editable English. Move it to `.langclarity/.orphaned/<timestamp>/<old-source-path>.md` and identify the former source path in metadata.
- **Restore/relink:** a restored source can be relinked to a matching orphan by old path and source hash; ambiguous matches require user choice.
- **English edit:** Markdown edits by a developer or filesystem-capable agent are ordinary English edits and re-derive state.
- **Scope:** untitled and out-of-workspace source documents are unsupported. In multi-root workspaces, each source maps into the `.langclarity/` tree of its owning workspace folder.
- **Discovery:** ignore `.langclarity/` as a source tree and prevent recursive interpretation.
- **Symlinks/case:** use VS Code workspace URIs and the owning workspace root as canonical identity. Test case-only renames on case-insensitive filesystems and use a safe intermediate rename if required.

## 13. Persistence and recovery

### 13.1 Storage behavior

- Native VS Code document handling preserves unsaved English Markdown edits and performs normal saves; the interpretation webview writes through that same document. LangClarity does not maintain another autosave mechanism.
- Code → English writes a complete validated Markdown result only after the response and base source remain current.
- On activation, do not eagerly parse or hash the entire workspace. Load a paired file only when its source or English document is used.
- Never silently alter `.gitignore`. After the first interpretation, offer an explicit action to add `/.langclarity/`; the user or team decides whether `.langclarity/` is committed.

### 13.2 Corruption and migration

- Validate frontmatter and required sections when synchronization is requested.
- A malformed Markdown document affects only its paired source and produces a recoverable message; it must not crash activation or erase the file.
- Preserve unknown newer schema data rather than overwriting it blindly.
- Schema migrations are explicit small transformations with fixtures and a diff/backup strategy before destructive rewrites.
- A failed migration retains the original Markdown and offers repair or re-interpretation.

### 13.3 Failure invariants

At all times:

1. Current source is changed only by an approved VS Code edit.
2. Current English is changed by user editing or a complete accepted Code → English response.
3. Synchronized baselines change only after a complete successful synchronization/apply.
4. A pending or failed request never erases the current Markdown document.
5. Cancellation, authentication-required, usage-limited, Codex-error, and LangClarity-error outcomes preserve current source, English, and synchronized baselines.
6. A successful synchronization refreshes the complete interpretation; no pane section is carried forward merely by advancing its baseline hash.

## 14. Large, generated, and incomplete files

Shipped MVP guardrails:

- source size: at most 75 KiB and 2,000 lines, whichever is reached first;
- English Markdown size: at most 256 KiB;
- connected files: direct imports only (no multi-edge path cap in use);
- concurrency: one request per file and at most two requests globally (`operationPolicy.ts`);
- progress: cancellable `withProgress` notifications immediately; no 30-second slow-operation notice;
- hard turn timeout: 180 seconds, with cancellation available when supported;
- maximum protocol/response line: 2 MiB;
- one complete proposed source document, diffed locally.

Do not expose settings for these values initially. A clear unsupported message is enough for the proof of concept.

When a model operation is over the limit, show a specific non-destructive message. Existing interpretations remain openable and locally editable. Function-level interpretation and chunking are later features.

Incomplete or invalid current source may be interpreted best-effort. If Codex or parsing cannot produce a trustworthy complete English result, retain the old English and offer retry. Never attempt arbitrary structure-editor recovery.

## 15. Security and privacy

- No LangClarity backend receives source in MVP.
- Clearly disclose that requested source and English are sent to Codex/OpenAI and governed by provider policies.
- Never request or persist API keys, ChatGPT passwords, auth cookies, access tokens, or refresh tokens.
- Store interpretations as ordinary Markdown under the owning workspace’s `.langclarity/` directory.
- Respect VS Code workspace trust. In an untrusted workspace, do not launch a local runtime or transmit source until the user trusts the workspace; the exact UI follows VS Code guidance.
- Disable Markdown command links or other executable content from model output unless VS Code’s trusted-Markdown controls make the content explicitly safe.
- Validate every parsed Markdown document and model response at the extension-host boundary.
- Pass runtime arguments without a shell and bound process I/O.
- Redact source, English, prompts, responses, tokens, and sensitive paths from logs.

## 16. Performance

MVP performance priorities:

- opening a normal source file adds no model latency;
- opening cached English requires only a Markdown read/parse (and custom editor load) plus one source hash;
- local English editing remains responsive and performs no AI work;
- hashing and parsing occur off the immediate UI path when files are non-trivial;
- only the active file’s necessary content is sent to Codex;
- requests are cancellable where possible and always stale-result safe;
- the extension does not scan or interpret a repository.

Model latency dominates synchronization. Show progress immediately and keep current content visible throughout the request.

## 17. Extensibility boundaries

Provide only these inexpensive seams:

- the two-operation `Interpreter` interface;
- language-specific parse/validate functions behind a small TypeScript/JavaScript service;
- versioned persisted records and prompt schemas;
- a Markdown parser/renderer independent of Codex transport.

Do not implement:

- provider discovery, credentials, or capability matrices beyond runtime model enumeration;
- a language plugin registry;
- semantic IR;
- persistent AST identity;
- repository-level graph/index;
- backend/service abstractions;
- merge algorithms or automatic synchronization modes.

Add those only in response to validated post-MVP requirements.

## 18. Testing strategy

### 18.1 Unit tests

Cover deterministic logic heavily:

- source and English hash canonicalization;
- Markdown parse/render round trips and generated-section exclusion;
- sync-state derivation for all hash combinations;
- stale async response rejection;
- structured response validation, exact line-count parity, consecutive line numbers, and persisted blank rows;
- supported-file and size-limit checks;
- parser/validation behavior for TS, JS, TSX, JSX, and incomplete fixtures;
- optionally, related-test classification remains deferred (MVP always returns `relatedTests: []`);
- frontmatter/body serialization, corruption handling, and migrations;
- model error normalization (`CodexResponseError` subclasses);
- both-changed authority rules.

### 18.2 Component tests

Use a fake `Interpreter` and temporary fixture workspace to test:

- initial interpretation success/failure;
- cached reopen and staleness;
- English edit persistence;
- Code → English replacement only after a complete response;
- English → Code validation and proposal lifecycle;
- source changing during a model request or diff review;
- cancellation and retry;
- external source changes;
- extension-originated edit loop prevention;
- optionally, assert that related-test recomputation is absent / `relatedTests` stays empty without an AI request or English-state transition.

### 18.3 VS Code integration tests

Run the extension test host against fixture workspaces to verify:

- commands and editor actions;
- pairing the correct source and Markdown-backed custom interpretation pane;
- document change events and workspace edits;
- virtual proposal documents and diff commands;
- persistence across extension-host restart;
- proposal diagnostics and Apply / Apply Anyway / Cancel behavior;
- no model call merely from opening a file;
- Markdown validation and state restore;
- rename/move/delete lifecycle, multi-root ownership, case-only rename, and orphan recovery;
- LF/CRLF, BOM, final newline, unsaved source buffers, and one-operation undo behavior;
- related-test mapping is omitted from MVP and is not an integration-test gate.

### 18.4 Codex contract tests

Keep live Codex tests separate from deterministic CI where authentication or model variability makes them unsuitable. Maintain:

- recorded sanitized protocol fixtures for routine tests;
- a manual/secure smoke test for runtime startup, authentication, structured Code → English, and English → Code;
- a shipped 12-fixture interpretation-fidelity corpus under `benchmarks/fidelity/` with `npm run benchmark:fidelity` and `npm run corpus:fidelity`;
- qualitative checks for hierarchy, important identifier preservation, contradictions, unsupported claims, evidence support, and unnecessary source rewrite size;
- repeated comparisons of supported reasoning efforts and prompt/schema variants while holding the model and fixture constant.

The initial one-file retest found that `medium` reasoning removed the contradiction observed at `low`. Earlier exploratory corpus notes remain historical. The shipped fidelity suite is the 12-fixture corpus above; expand with repeated, randomized or rotated runs, retained raw outputs, expert-authored must-have/prohibited claims, and blinded semantic evidence review before setting thresholds or adding a second critic call.

### 18.5 End-to-end acceptance

Automate where stable and manually certify the complete scenario in PRD section 14 before release. Include forced runtime failure, invalid model output, source divergence during review, cancellation, and restart recovery. No critical user work may be lost.

## 19. Implementation plan

Phases 0–5 are implemented in the current extension. Phase 6 release-candidate polish and release-owner certification remain partially open. Later notes mark unfinished items explicitly.

### Phase 0 — Codex protocol proof before extension development — complete

**Purpose:** retire the highest-risk integration assumptions. This gate passed on 2026-08-22 with Codex CLI `0.148.0-alpha.15`.

Completed evidence:

- disposable TS/JS fixture, recorded runtime version, generated TypeScript/JSON protocol schemas, and successful stdio `initialize`;
- `account/read` confirmed existing Codex-managed ChatGPT authentication without API-key handling;
- `model/list` returned six visible runtime models, defaults, and supported efforts; the runtime default and an allowed alternate both completed turns;
- Code → English and English → Code returned schema-valid results in a read-only, no-approval, ephemeral thread;
- fixture file hashes and sizes were unchanged after all turns;
- `turn/interrupt`, restart/reconnect, missing executable, and local stale/malformed guards passed;
- current-version acceptance and simulated older-version rejection passed against the provisional minimum;
- measured live-turn latencies and payload sizes remained below the starting section 14 limits.

**Open (non-blocking certification):** exercise login initiation/cancellation with a signed-out account, test rejection with an actual older binary, and inject malformed data through a live stream rather than only at the client boundary.

Acceptance criteria:

- no API key or LangClarity backend is used;
- authentication is Codex-managed and the extension never receives credentials;
- runtime model enumeration and fallback behavior are understood;
- both directions return schema-validated data without runtime file writes;
- cancellation, restart, malformed responses, and missing/incompatible runtime states have explicit outcomes;
- the minimum supported Codex version and initial limits are recorded.

Preserve the gate as a reproducible contract suite because the app-server is experimental; regenerate protocol definitions and re-run it when the minimum Codex version changes. If a future version cannot provide a sufficiently stable supported route, stop and make a product decision rather than substituting an API key.

### Phase 1 — Extension scaffold and initial interpretation — complete

**Purpose:** deliver the first useful Code → English experience.

Delivered:

- TypeScript VS Code extension scaffold with compile/test/lint;
- Open Interpretation, Interpret File, and supported-source context submenu;
- supported-file gating and empty/missing-Codex/sign-in/loading/error presentation;
- `.langclarity/` path mapping, Markdown schema, validation, rendering, and side-by-side custom interpretation view;
- Codex interpreter request for initial interpretation;
- redacted output-channel logging.

Acceptance criteria met for representative fixtures: opening source alone performs no model call; explicit interpretation returns structured English; failed or malformed responses leave source and existing Markdown intact.

### Phase 2 — Markdown lifecycle and staleness — complete

**Purpose:** make English persistent and source divergence visible.

Delivered:

- frontmatter/body schema including `editableEnglishHash` / `mappingRevisionHash`, atomic writes, and migrations;
- source/English canonical hashes;
- paired rename/move/delete/orphan behavior;
- load on demand across restarts;
- observe source/English changes and derive stable sync states.

Acceptance criteria: saved interpretations survive restart; identical source opens `SYNCED`; edited/external source opens `CODE_CHANGED` without a model call; malformed documents fail per file without activation failure.

### Phase 3 — English → Code proposal — complete

**Purpose:** safely turn English edits into reviewable source changes.

Delivered:

- English → Code request and result validation (`summary` required);
- full proposed documents, syntax parse, and proposal diagnostics;
- virtual proposal documents and VS Code diffs;
- Apply / Apply Anyway / Cancel with base-hash checks;
- apply waits for proposed-source Code → English refresh, then writes source + refreshed Markdown in one `WorkspaceEdit`.

Acceptance criteria: source is never written before approval; invalid syntax is blocked; diagnostics force Apply Anyway / Cancel; stale proposals cannot apply; success returns `SYNCED`.

### Phase 4 — Code → English refresh — complete

**Purpose:** complete bidirectional use after ordinary source editing.

Delivered:

- refresh existing English from current code;
- preserve current English until a complete accepted response;
- reject stale responses after source or English changes;
- reuse refresh for post-proposal interpretation updates.

Acceptance criteria: a manual source edit marks English stale; explicit Code → English refreshes and persists it; failures/cancellation retain the previous English; success returns both hashes to synchronized baselines.

### Phase 5 — Conflicts, failures, and safeguards — complete

**Purpose:** make normal divergence and unreliable operations safe.

Delivered:

- `BOTH_CHANGED` direction choice and warnings;
- cancellation, 180s turn timeout, retry, authentication/usage-limited error classes, Codex-message pass-through, and local-error presentation;
- file/English/response limits (including 256 KiB English);
- incomplete code and external changes during operations;
- persistence and recovery hardening.

Acceptance criteria: both-changed never merges automatically; the selected side becomes authoritative only after success/approval; injected failures preserve current source and English; over-limit files are rejected clearly and non-destructively.

### Phase 6 — Polish, verification, and publishing — release candidate (partially open)

**Purpose:** prepare an MVP that can be evaluated by real developers.

Delivered so far:

- onboarding/privacy/troubleshooting and platform-limit documentation;
- status surface accessibility information;
- runtime-returned model and reasoning selection with workspace persistence and fallback;
- custom interpretation webview as primary English UX, with native Markdown via `openMarkdown`;
- 12-fixture fidelity corpus (`benchmark:fidelity` / `corpus:fidelity`);
- packaging scripts and MIT/public repository metadata.

Related-test mapping remains omitted (always `[]`) as deferred enrichment without a precision/reviewability gate.

**Open release-owner items** (see [MVP_RELEASE_CHECKLIST.md](./MVP_RELEASE_CHECKLIST.md)): fresh-profile manual workflow checklist, signed-out-account certification, and Marketplace publisher ownership. Historical packaging snapshots (for example an earlier “40 tests” / ~1.63 MiB VSIX note from 2026-08-23) are obsolete; re-verify test counts and package size at release time rather than treating those figures as current.

Acceptance criteria:

- all PRD acceptance criteria pass;
- no known critical data-loss, credential, or source-leak issue remains;
- fresh-install and restart flows work on supported VS Code platforms;
- documentation states supported languages, Codex prerequisite, privacy behavior, and known limits.

## 20. Technical risk register

| Risk | Impact | Likelihood | Mitigation / validation | MVP blocker? |
| --- | --- | --- | --- | --- |
| Supported Codex runtime integration is unavailable or unstable | Cannot deliver subscription-based interpreter/auth model | Medium | Phase 0 spike against official supported interface; normalize lifecycle and auth states; avoid depending on terminal scraping | Yes, if no supported path exists |
| Structured model output is malformed or inconsistent | English cannot render safely; proposals fail | Medium | Strict schemas, bounded retries if justified, response fixtures, prompt evaluation, preserve last good state | No, unless reliability is unusable |
| Schema-valid English is unsupported or internally contradictory | Users trust a structurally valid but false interpretation | Medium–High | `medium` reasoning recommendation, exact source-line correspondence, source-supported prompt rules, local deterministic facts, contradiction benchmark, user review | Product-risk blocker if pilot quality is unusable |
| English lacks useful hierarchy or misrepresents code | Users distrust the second surface | Medium–High | Evaluation corpus, prompt/schema iteration, visible staleness, easy Code → English retry, user review | Product-risk blocker if pilot quality is unusable |
| English → Code rewrites too much source | Diffs are hard to trust and may introduce regressions | Medium–High | Include baseline/current source and mappings, request minimal changes, measure diff size, always preview, cancel/retry | No; may block product validation if pervasive |
| Source changes while a request or diff is pending | Stale proposal overwrites newer work | High without controls | Operation IDs, base hashes, document versions, final pre-apply hash check | Yes if not mitigated |
| Source/Markdown watchers form update loops | Repeated state changes or accidental model calls | Medium | One session coordinator, origin/expected-hash tokens, generated-section hash exclusion, model calls only from commands | Yes if destructive; otherwise fix before release |
| Stored line mappings become stale | Wrong context or proposals | High | Validate exact line parity, hash whole source, regenerate on Code → English | No |
| Optional related tests are missing (always empty in MVP) | Users may expect navigation hints that are not present | Low | Document empty Related tests section; defer enrichment until precision/reviewability gate exists | No |
| Incomplete or invalid current syntax reduces interpretation quality | Common editing states fail | High | Best-effort requests, clear retryable error, never replace last good English on failure | No |
| Large/minified files exceed context or stall the extension | Failed calls, latency, resource use | Medium | Byte/line/English/response limits, Phase 0 measurement, clear rejection, no MVP chunking | No |
| Git/external tools change source outside active editor | Cached English silently becomes inaccurate | High | Document and file watchers, exact content hashes, on-open recheck | Yes if staleness is not detected |
| Markdown metadata is malformed or schema changes | A file cannot synchronize | Low–Medium | Versioned frontmatter, strict per-file validation, non-destructive migrations, retain original text | No |
| Syntax validation passes but change is type/logically wrong | User applies broken behavior | High | Diagnostics warning, exact diff, explicit apply, honest product messaging; no correctness guarantee | No |
| Sensitive content appears in logs or executable Markdown | Privacy/security incident | Low–Medium | Redacted logs, trusted-Markdown controls, no prompt logging by default, clear Git/share disclosure | Yes for release |
| Users mistake English as guaranteed truth | Incorrect understanding or unsafe edits | Medium | Clear stale/status UI, review model, non-marketing correctness language, pilot feedback | No, but central product risk |

## 21. Release gates

Before MVP release:

1. Phase 0 confirms a supported Codex runtime/auth route; no API-key fallback is introduced.
2. All state/hash combinations and stale-response races have automated coverage.
3. English → Code cannot mutate source before a diff and explicit approval.
4. A source change after proposal creation reliably blocks application.
5. Failures injected at every asynchronous boundary preserve source and the current Markdown document.
6. Markdown trust behavior, protocol validation, logging redaction, and workspace trust behavior are reviewed.
7. The full PRD acceptance scenario passes on a fresh install and after restart.
8. Practical file/context limits and privacy behavior are visible to users.
9. Paired Markdown rename/move/delete handling preserves user-authored English and passes lifecycle fixtures.

## 22. Deferred decisions

The following remain deliberately deferred or unfinished:

- function-level versus full-file interpretation for files beyond MVP limits;
- stronger source mappings or semantic IR;
- multi-edge connected-file context, heuristic candidates, and connected English summaries;
- provider and language expansion;
- on-save or idle synchronization;
- whether teams should commit or ignore `.langclarity/` by default;
- orphan retention and cleanup policy beyond preserving deleted-source interpretations;
- related-test mapping quality and presentation (MVP always leaves Related tests empty);
- further fidelity corpus ownership, graders, sample size, repeated-run design, baseline thresholds, and pilot recruitment beyond the shipped 12-fixture suite;
- whether a second critic/review call improves fidelity enough to justify its additional latency and usage;
- analytics, accounts, licensing, and backend services;
- a standalone editor;
- Marketplace publisher ownership and remaining release-owner certification items.

None of these blocks the implemented MVP core flows.
