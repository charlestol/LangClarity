# LangClarity Technical One-Pager — Implementation Reference

## 1. Purpose and status

This document turns the requirements in [PRD.md](./PRD.md) into an implementation-ready MVP design. [High_Level_Tech_Doc.md](./High_Level_Tech_Doc.md) is the concise architecture map; this document contains the deeper implementation reference for module responsibilities, state and data contracts, workflows, delivery phases, risks, and verification.

This is a pre-development design with the Codex integration gate completed. On 2026-08-22, installed Codex CLI `0.148.0-alpha.15` passed end-to-end stdio initialization, existing-account detection, dynamic model enumeration, schema-valid turns in both directions, cancellation, restart, missing-runtime handling, and zero-write checks in a disposable fixture. The app-server is still experimental, so generated protocol contracts and a minimum-version gate remain mandatory.

## 2. Design principles

1. **Validate the thesis, not a theoretical compiler.** Use an LLM, useful syntax/AST context, persistent English, and explicit synchronization.
2. **Keep source editing native.** Source remains an ordinary VS Code document; do not recreate an editor or language service.
3. **Make AI writes reviewable.** Codex returns a proposal. It never writes source directly.
4. **Commit state only after complete success.** Model, validation, preview, or apply failures must preserve both representations.
5. **Treat external edits as normal.** VS Code, Git, extensions, and filesystem tools may all change source.
6. **Keep abstractions proportional to MVP.** Isolate Codex behind two operations, but do not build a provider marketplace or semantic IR.
7. **Prefer inspectable files over hidden state.** The Markdown under `.langclarity/` is the English representation and is readable by developers and filesystem-capable agents.
8. **Prefer coarse mappings that work.** Function/block/source-range mappings are useful; permanent identity for every sentence or AST node is not required.

## 3. Assumptions and decisions to validate

### 3.1 Assumptions

- MVP runs as a desktop VS Code extension with access to a local Codex runtime. VS Code for the Web is not targeted.
- “TypeScript and JavaScript” provisionally includes `.ts`, `.tsx`, `.js`, and `.jsx`; narrowing this to `.ts` and `.js` changes eligibility and parser configuration, not the design.
- One source file has at most one Markdown interpretation in its owning workspace folder.
- Source `src/users.ts` maps to `.langclarity/src/users.ts.md`. Retaining the source extension prevents `.ts`/`.js` basename collisions.
- Both source and English use native VS Code text editors. A custom webview is unnecessary for the proof of concept.
- `.langclarity/` is ordinary workspace content. LangClarity does not silently commit it or add it to `.gitignore`.
- A full proposed source document is the simplest reliable internal contract for English → Code, even if Codex returns a patch. The proposal coordinator always materializes the exact final document before validation and preview.

### 3.2 Phase 0 findings

The executable proof established:

1. Codex `0.148.0-alpha.15` supports stdio app-server startup, `initialize`, `account/read`, `model/list`, `thread/start`, `turn/start`, structured `outputSchema`, and `turn/interrupt` for the tested authenticated account.
2. `model/list` returned six visible models with default flags and supported reasoning efforts. This is a runtime snapshot, not a catalog to hard-code.
3. Both directions returned schema-valid data while the read-only/no-approval fixture remained byte-for-byte unchanged; cancellation and restart also passed.
4. Missing-executable, stale-response, malformed-protocol, and malformed-result guards passed at the client boundary. An older-version rejection passed with a simulated version string.
5. Login initiation/cancellation was not exercised because the account was already authenticated. Native Markdown lifecycle behavior remains extension implementation work, not a Codex integration blocker.
6. Schema validity did not guarantee semantic fidelity: the first Code → English response contained an internal input-mutation contradiction.

If Codex cannot be invoked through an official supported local interface with Codex-managed ChatGPT authentication, that is an MVP-blocking integration finding and requires a product decision. It must not be silently replaced with API-key auth.

## 4. System context

```text
┌──────────────────────────── VS Code Extension Host ───────────────────────────┐
│                                                                              │
│  Commands/status ── Native Markdown ── Session coordinator ─ Source docs     │
│                          │                  │                  │              │
│                   .langclarity tree         ├── State          ├── Parser     │
│                                             ├── Mappings       ├── Validator  │
│                                             └── Proposals      └── Diff/apply │
│                                                   │                          │
└───────────────────────────────────────────────────┼──────────────────────────┘
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

No LangClarity service is in the inference or authentication path. Interpretations remain as local Markdown in the workspace’s `.langclarity/` tree.

## 5. Major components

### 5.1 Extension entry point

Responsibilities:

- register commands, view providers, and status UI;
- construct services and dispose resources;
- enforce workspace trust and supported-document prerequisites;
- route user actions to the correct file session.

Keep this layer thin. Business state belongs in the session coordinator.

### 5.2 English document view

A normal VS Code Markdown editor provides the editable English surface paired with one source URI. Open it beside the source with `vscode.window.showTextDocument`.

Responsibilities:

- use predictable headings and lists that preserve readable hierarchy;
- retain native editing, undo/redo, search, accessibility, Git diff, and agent filesystem access;
- expose synchronization through commands, editor/title actions, CodeLens, or status items;
- validate required metadata/headings only when a sync is requested;
- keep current Markdown intact when validation or interpretation fails.

The Markdown file is the durable source of truth for English. There is no duplicate English buffer in extension storage and no custom structured editor in MVP.

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
- resolve direct imports/exports and bounded static dependency paths with evidence;
- optionally build bounded paths from recognized test files back to the interpreted source file;
- distinguish verified relationships, static-path relationships, and heuristic candidates;
- collect relevant diagnostics after a syntactically valid proposal.

AST context is advisory input and mapping metadata, not a persistent semantic model. Incomplete current code may be submitted best-effort when useful; an unparseable proposed document is not ordinarily applicable.

### 5.6 Interpreter boundary

MVP exposes only the operations it needs:

```ts
interface Interpreter {
  codeToEnglish(input: CodeToEnglishInput): Promise<EnglishDocument>;
  englishToCode(input: EnglishToCodeInput): Promise<CodeChangeResult>;
}
```

`CodexInterpreter` is the only implementation. The interface isolates process/protocol details for testing and future replacement. MVP includes model selection only from models enumerated by the authenticated Codex runtime; it does not include provider selection or a generic capability system.

Responsibilities:

- connect to or start the supported Codex runtime;
- report runtime and Codex-managed auth state;
- enumerate non-hidden models and their supported reasoning efforts;
- construct bounded prompts containing source, structured English, mappings, and direction-specific instructions;
- request schema-conforming responses;
- validate response shape and pass Codex error messages through without parsing or reclassification;
- support cancellation when exposed by the runtime and enforce LangClarity's own operation timeout.

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
- ensure the proposal is based on the current source hash;
- run syntax validation and collect diagnostics;
- expose the proposal through VS Code’s diff UI using an in-memory/virtual document;
- apply only after explicit approval and a final base-hash check;
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

### 6.2 Runtime states

Keep known account/runtime availability separate from operation failures:

```ts
type CodexStatus =
  | { kind: "unavailable"; setupMessage: string }
  | { kind: "starting" }
  | { kind: "authentication-required" }
  | { kind: "authenticating" }
  | { kind: "usage-limited"; message?: string }
  | { kind: "ready" };

type LangClarityError =
  | { source: "codex"; message: string; willRetry?: boolean }
  | { source: "langclarity"; message: string };

type OperationResult =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "authentication-required" }
  | { status: "usage-limited"; message?: string }
  | { status: "failed"; error: LangClarityError };
```

For any failure returned by Codex, use its returned message verbatim for the user-facing `codex` error. Do not branch on, regex-match, translate, or maintain product copy for Codex message text. If Codex supplies no usable message, use a generic unknown-Codex-error fallback. Structured Codex details may be retained for redacted diagnostics, but MVP product behavior does not depend on them. `willRetry`, when supplied by Codex, controls only whether the UI says Codex is retrying.

LangClarity-originated errors cover conditions the extension detects itself, including missing/incompatible runtime, process startup or exit, local timeout, invalid protocol data, workspace access, and source access. These conditions share the same `langclarity` error shape rather than separate public error types. Cancellation is not an error; authentication required and usage limited are explicit account states.

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
languageId: typescript
promptVersion: 1
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

### `getTopUsers`

1. Get the users.
2. Keep users who:
   - are active;
   - are located in the US.
3. Sort by score, highest first.
4. Return the first 10.

## Symbols
## Dependencies
## Related files
## Related tests
## Side effects
## Constraints
```

Frontmatter keys and section headings are versioned. Empty sections are permitted when the source provides no supported facts. The document remains useful as ordinary Markdown even when the extension is absent.

### 7.2 Structured contract

LangClarity composes the document from a validated model response and locally derived facts, then renders it into Markdown. The model response supplies purpose, responsibilities, behavior, side effects, and constraints; source identity, symbols, imports/exports, relationships, and optional test evidence come from local analysis. The parsed form of the complete Markdown document uses this conceptual contract:

```ts
interface EnglishDocument {
  schemaVersion: 1;
  source: {
    path: string;
    languageId: string;
    hash: string;
  };
  purpose: string;
  responsibilities: string[];
  behavior: EnglishBlock[];
  symbols: SymbolSummary[];
  relationships: VerifiedRelationship[];
  sideEffects: string[];
  constraints: string[];
}

interface EnglishBlock {
  text: string;
  depth: number;
  evidence?: SourceEvidence;
}

interface SourceEvidence {
  startLine?: number;
  endLine?: number;
  symbolName?: string;
}

interface SymbolSummary {
  name: string;
  kind: string;
  responsibility: string;
}

interface VerifiedRelationship {
  path: string;
  kind: "import" | "export" | "type" | "test" | "candidate";
  evidence: string;
}
```

Relationships and related tests are derived locally rather than accepted as unconstrained model claims:

```ts
interface RelatedTestMapping {
  testUri: string;
  testKind: "unit" | "integration" | "e2e" | "unknown";
  evidence:
    | { kind: "direct-import"; importedSymbols?: string[] }
    | { kind: "static-dependency-path"; path: string[] }
    | { kind: "naming-or-location-convention"; convention: string };
}
```

Validation rules:

- `behavior` is ordered and bounded;
- text is non-empty plain text with bounded length;
- depth is a non-negative integer with a practical maximum;
- important behavior claims include a source symbol or line range when available;
- ranges, when present, are ordered and fit within the exact numbered source submitted with the request;
- evidence is an inspectability hint and never proves correctness or authorizes edits by itself;
- related-test URIs resolve inside the workspace and static paths terminate at the interpreted source file;
- convention-based test candidates remain visibly distinct from import/path-supported mappings.

Block identity and indentation can be recalculated when synchronization begins. MVP does not require stable sentence or AST-node identity across edits or regenerations.

Locally generated sections, such as verified relationship/test evidence, use explicit HTML comment boundaries. They are excluded from the editable-English hash so deterministic refreshes do not incorrectly produce `ENGLISH_CHANGED`:

```md
<!-- langclarity:generated:start relationships -->
...
<!-- langclarity:generated:end relationships -->
```

### 7.3 Connected-file discovery

Connected-file context is bounded and evidence-based:

1. Derive direct imports, exports, and resolvable module references locally with the TypeScript compiler API.
2. Label direct relationships as verified and retain their resolution evidence.
3. Follow static paths only when a user explicitly requests connected context, with a maximum of four edges.
4. Include a connected file’s English summary only when its paired `.langclarity/` Markdown already exists. Do not automatically interpret the repository.
5. Label naming/location heuristics as candidates rather than facts.
6. Recompute this local mapping after relevant source or resolver-configuration changes without invoking Codex.

This is a small navigation/context map, not a repository-wide semantic graph or an AI-generated index.

### 7.4 Related-test discovery

Related-test discovery is optional enrichment and not a core MVP gate. When included, maintain a lightweight inventory using `vscode.workspace.findFiles`, TypeScript module resolution, common conventions, and readable workspace test configuration. Exclude `.langclarity`, `node_modules`, `dist`, `out`, and generated/vendor directories.

For each interpreted source file:

1. Mark tests that directly import the file or one of its exported symbols as direct mappings.
2. Traverse static import paths from a test toward the source file, capped at four edges. Resolve `tsconfig`/`jsconfig` path aliases where the TypeScript resolver can do so.
3. Add co-located or convention-matched files such as `*.test.*`, `*.spec.*`, `__tests__`, `test`, and `tests` entries as candidates when no stronger evidence exists.
4. Recognize common Playwright/Cypress configuration and E2E directories. Because E2E tests often exercise routes without importing implementation modules, label them as candidates unless a static path exists.
5. Recompute mappings locally when relevant workspace files change. This must not invoke Codex.

Test mappings are documentation/navigation hints, not regression detection, coverage proof, or impact guarantees. They do not synthesize commands or automatically execute tests.

### 7.5 Model instructions

Code → English requests should instruct Codex to:

- preserve logical hierarchy, ordering, and control flow;
- remain concise and editable;
- avoid generic narrative prose;
- include useful identifiers;
- represent functions/classes recognizably;
- make only claims supported by the submitted source and prefer omission when uncertain;
- distinguish mutation of inputs from mutation of temporary or copied values;
- check behavior, side effects, and constraints for contradictions before returning;
- attach a source symbol or valid line range to important behavior claims;
- return only the required structured result.

LangClarity derives source path/hash, declarations and symbols, imports/exports, resolvable relationships, and optional related-test evidence locally. These deterministic facts may be supplied as context or rendered into generated Markdown sections, but they are not delegated to unconstrained model output.

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

The Markdown body is the current editable English and is not duplicated in `workspaceState`. `editableEnglishHash` is the last synchronized baseline of user-editable sections. `mappingRevisionHash` covers normalized local relationship/test evidence and relevant resolver configuration separately. Updating generated evidence alone does not change synchronization state.

`workspaceState` may hold non-content preferences such as the selected model and dismissed notices. It must not become a hidden second copy of English.

### 8.2 Runtime session

```ts
interface FileSession {
  id: string;
  sourceUri: string;
  sourceDocumentVersion?: number;
  currentSourceHash: string;
  englishUri: string;
  currentEnglish: EnglishDocument;
  currentEnglishHash: string;
  baselineSourceHash: string;
  baselineEnglishHash: string;
  state: SyncState;
  pending?: PendingOperation;
  error?: SessionError;
}
```

### 8.3 Synchronization state

```ts
type StableSyncState =
  | "SYNCED"
  | "CODE_CHANGED"
  | "ENGLISH_CHANGED"
  | "BOTH_CHANGED";

type SyncState = StableSyncState | "INTERPRETING" | "ERROR";
```

`INTERPRETING` and `ERROR` are presentation/operation overlays. The session retains its last stable state so cancellation or failure can return to it without pretending the documents are synchronized.

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
  summary?: string;
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
- Hash normalized dependency/test evidence and relevant configuration separately as `mappingRevisionHash`.
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
| Start directional sync | No pending operation; conflict choice resolved | `INTERPRETING` over prior stable state |
| Operation fails/cancels | Pending operation matches | Return to prior stable state and show error/cancel outcome |
| Code → English succeeds | Base source still current | Replace English and both baselines; `SYNCED` |
| English → Code proposal succeeds | Both bases still current | Remain pending review; stable state unchanged |
| Proposal applied | Base source still current | Apply source, update both baselines; `SYNCED` |
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
3. Create or focus its session and open the Markdown document beside the source if it exists.
4. Read exact current source and compute its hash.
5. If no Markdown exists, offer **Interpret File**. Do not create a placeholder or contact Codex merely from opening source.
6. If Markdown exists, parse its metadata/body and derive state.
7. If the source hash differs, keep the Markdown visible as stale and expose Code → English.

### 10.2 Initial Code → English

1. User selects **Interpret File**.
2. Re-read source and enforce supported language and size limits.
3. Ensure Codex is available and authenticated, using Codex’s login flow if required.
4. Capture source hash and operation ID; set progress overlay.
5. Optionally parse coarse syntax context; parsing failure may produce a best-effort request.
6. Send bounded source/context and the structured output schema.
7. Validate the entire response and mapping ranges.
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
4. Send current source and structured English, requesting a minimal code change and a structured result.
5. Convert the result to one exact proposed source document.
6. Reject an empty, malformed, over-limit, or wrong-language result.
7. Reject the result if either captured base changed while awaiting Codex.
8. Parse the proposal. Syntax errors block normal apply and are displayed.
9. Collect TypeScript/JavaScript diagnostics. New or relevant type errors warn but do not necessarily block apply.
10. Register a read-only virtual document and show the VS Code diff against current source.
11. Offer **Apply**, **Apply Anyway** only when policy permits, or **Cancel**.

The diff must show exactly the content that would be applied. Do not generate a new response after preview without opening a new proposal.

### 10.5 Apply proposal

1. Re-read current source and compare its hash with `baseSourceHash`.
2. If it differs, reject the apply and ask the user to regenerate; never patch onto an unknown base.
3. Compute minimal text edits against the exact current VS Code buffer and apply them as one `WorkspaceEdit`. Do not write the source through raw filesystem APIs and do not auto-save it.
4. Mark the edit with a short-lived operation token or expected resulting hash so its change event is recognized.
5. Verify the document’s resulting exact hash. Preserve its EOL style, BOM/encoding behavior, and unrelated final-newline state; do not invoke formatting.
6. Persist the current English as its baseline and the resulting source hash as the source baseline.
7. Clear proposal/pending/error state and publish `SYNCED`.

If application or verification fails, do not update the synchronized baselines. The approved application is one undoable editor operation, and the user remains responsible for saving the source document.

## 11. Diff generation and validation

### 11.1 Proposal form

Ask Codex for a structured full-source result or structured patch, depending on what Phase 0 proves most reliable. Internally always materialize a full proposed document. This simplifies:

- syntax parsing;
- diff preview;
- stale-base checks;
- exact apply verification;
- failure atomicity.

### 11.2 Syntax validation

Use the TypeScript compiler API with the correct script kind. A proposed `.ts`/`.tsx` file with parse diagnostics is invalid. For JavaScript, parse diagnostics are treated equivalently.

Syntax-invalid proposals may be viewed for troubleshooting but do not get ordinary **Apply**. A future escape hatch is not part of MVP unless user testing proves necessary.

### 11.3 Type/language diagnostics

After syntax succeeds, compare or at least report diagnostics from VS Code/TypeScript. Because projects may already contain errors and model output is not guaranteed type-correct:

- diagnostic warnings do not hard-block MVP apply;
- the UI clearly states the relevant count and affected lines;
- **Apply Anyway** requires an explicit action.

Prefer showing newly introduced diagnostics when the language-service API makes comparison reliable. Falling back to proposal diagnostics is acceptable and should be labeled accurately.

## 12. File-change detection and loop prevention

Listen for VS Code text-document changes, workspace create/delete/rename events, and file watcher events for paired source/Markdown documents.

Rules:

- Recompute the source hash from current text and derive state; never assume all change events are user edits.
- Debouncing hash computation for rapid local edits is allowed because it does not invoke AI or alter content.
- An extension apply records `{uri, operationId, expectedHash}` before calling the edit API.
- Matching document-change events are still observed, but the expected result is finalized as the same apply rather than starting another sync.
- Unexpected content or an interleaved user edit invalidates the proposal and re-derives state.
- No source-change event automatically starts Codex.
- Generated relationship/test section updates carry an extension-origin token and do not create `ENGLISH_CHANGED` because those sections are excluded from the editable hash.
- Relevant source, test, import, `tsconfig`, `jsconfig`, Playwright, or Cypress changes may recompute local mapping evidence without an AI call.

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

- Native VS Code document handling preserves unsaved English edits and performs normal saves; LangClarity does not maintain another autosave mechanism.
- Code → English writes a complete validated Markdown result only after the response and base source remain current.
- On activation, do not eagerly parse or hash the entire workspace. Load a paired file only when its source or English document is used.
- Never silently alter `.gitignore`. The user or team decides whether `.langclarity/` is committed.

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

## 14. Large, generated, and incomplete files

Start with these code-level guardrails and adjust them only from Phase 0 evidence:

- source size: at most 75 KiB and 2,000 lines, whichever is reached first;
- static dependency path: at most four edges;
- concurrency: one request per file and two requests globally;
- progress: immediate, with a slow-operation notice after 30 seconds;
- hard request timeout: three minutes, with cancellation available when supported;
- maximum structured response: 2 MiB;
- one complete proposed source document, diffed locally.

Do not expose settings for these values initially. A clear unsupported message is enough for the proof of concept.

When a file is over the limit, show a specific non-destructive message. Function-level interpretation and chunking are later features.

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
- opening cached English requires only a Markdown read/parse and one source hash;
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
- structured response validation and range checks;
- supported-file and size-limit checks;
- parser/validation behavior for TS, JS, TSX, JSX, and incomplete fixtures;
- optionally, related-test classification, bounded dependency traversal, evidence paths, and convention fallback;
- frontmatter/body serialization, corruption handling, and migrations;
- model error normalization;
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
- optionally, related-test recomputation without an AI request or English-state transition.

### 18.3 VS Code integration tests

Run the extension test host against fixture workspaces to verify:

- commands and editor actions;
- pairing the correct source and native Markdown editor;
- document change events and workspace edits;
- virtual proposal documents and diff commands;
- persistence across extension-host restart;
- diagnostics display and apply behavior;
- no model call merely from opening a file;
- Markdown validation and state restore;
- rename/move/delete lifecycle, multi-root ownership, case-only rename, and orphan recovery;
- LF/CRLF, BOM, final newline, unsaved source buffers, and one-operation undo behavior;
- if optional test mapping ships, related tests and evidence appear for direct, static-path, and convention fixtures without becoming a release gate.

### 18.4 Codex contract tests

Keep live Codex tests separate from deterministic CI where authentication or model variability makes them unsuitable. Maintain:

- recorded sanitized protocol fixtures for routine tests;
- a manual/secure smoke test for runtime startup, authentication, structured Code → English, and English → Code;
- a small prompt-evaluation corpus covering functions, classes, async control flow, React syntax if supported, and incomplete code;
- qualitative checks for hierarchy, important identifier preservation, contradictions, unsupported claims, evidence support, and unnecessary source rewrite size;
- repeated comparisons of supported reasoning efforts and prompt/schema variants while holding the model and fixture constant.

The initial one-file retest found that `medium` reasoning removed the contradiction observed at `low`. A later six-fixture, 12-call medium-effort corpus found both baseline and evidence-linked variants covered all 27 expert-authored facts with no detected prohibited claims or contradictions. The evidence-linked variant added 25 structurally valid ranges and averaged 37% more latency, improving traceability rather than measured factual coverage. Expand to 10–20 representative files with repeated, randomized or rotated runs, retained raw outputs, expert-authored must-have/prohibited claims, and blinded semantic evidence review before setting thresholds or adding a second critic call.

### 18.5 End-to-end acceptance

Automate where stable and manually certify the complete scenario in PRD section 14 before release. Include forced runtime failure, invalid model output, source divergence during review, cancellation, and restart recovery. No critical user work may be lost.

## 19. Implementation plan

Each phase should end in demonstrable behavior and passing checks. Later phases depend on the earlier contracts but should not add speculative framework work.

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

Remaining non-blocking certification work: exercise login initiation/cancellation with a signed-out account, test rejection with an actual older binary, and inject malformed data through a live stream rather than only at the client boundary.

Acceptance criteria:

- no API key or LangClarity backend is used;
- authentication is Codex-managed and the extension never receives credentials;
- runtime model enumeration and fallback behavior are understood;
- both directions return schema-validated data without runtime file writes;
- cancellation, restart, malformed responses, and missing/incompatible runtime states have explicit outcomes;
- the minimum supported Codex version and initial limits are recorded.

The extension scaffold may begin. Preserve the gate as a reproducible contract suite because the app-server is experimental; regenerate protocol definitions and re-run it when the minimum Codex version changes. If a future version cannot provide a sufficiently stable supported route, stop and make a product decision rather than substituting an API key.

### Phase 1 — Extension scaffold and initial interpretation

**Purpose:** deliver the first useful Code → English experience.

Major tasks:

- generate the official TypeScript VS Code extension scaffold in a temporary directory and merge it without overwriting `docs/`;
- choose **New Extension (TypeScript)**, npm, and the generator’s unbundled default; keep its test/lint setup and add no UI framework. Consider esbuild only when packaging evidence justifies it;
- register Open English View and Interpret File commands;
- implement supported-file gating and empty/missing-Codex/sign-in/loading/error states;
- implement `.langclarity/` path mapping, Markdown schema, validation, rendering, and native side-by-side opening;
- implement the Codex interpreter request for initial interpretation;
- add redacted output-channel logging.

Dependencies: Phase 0 runtime and structured-output choices.

Acceptance criteria:

- opening source alone performs no model call;
- an explicit request returns useful structured English for representative fixtures;
- failed or malformed responses leave source and existing Markdown intact.

### Phase 2 — Markdown lifecycle and staleness

**Purpose:** make English persistent and source divergence visible.

Major tasks:

- implement frontmatter/body schema, atomic writes, and migrations;
- implement source/English canonical hashes;
- implement paired rename/move/delete/orphan behavior;
- load on demand across restarts;
- observe source changes and derive stable sync states.

Dependencies: stable English schema from Phase 1.

Acceptance criteria:

- saved interpretations and English edits survive restart as ordinary Markdown;
- identical source opens `SYNCED`;
- edited/external source opens `CODE_CHANGED` without a model call;
- malformed documents fail per file without activation failure.

### Phase 3 — English → Code proposal

**Purpose:** safely turn English edits into reviewable source changes.

Major tasks:

- build the English → Code request and result validation;
- materialize full proposed documents;
- parse syntax and collect diagnostics;
- create virtual proposal documents and open VS Code diffs;
- implement Apply/Apply Anyway/Cancel with base-hash checks;
- verify apply results and prevent update loops.

Dependencies: persistence baselines and file-session coordinator.

Acceptance criteria:

- a small English edit commonly produces a focused diff;
- source is never written before approval;
- invalid syntax is blocked and diagnostics warn accurately;
- stale proposals cannot apply;
- success updates baselines and returns `SYNCED`.

### Phase 4 — Code → English refresh

**Purpose:** complete bidirectional use after ordinary source editing.

Major tasks:

- refresh existing English from current code;
- preserve current English until a complete accepted response;
- add mapping/baseline context when it improves update quality;
- reject stale responses after source or English changes.

Dependencies: Phases 1–3 session, storage, and operation contracts.

Acceptance criteria:

- a manual source edit marks English stale;
- explicit Code → English refreshes and persists it;
- failures/cancellation retain the previous English;
- success returns both hashes to synchronized baselines.

### Phase 5 — Conflicts, failures, and safeguards

**Purpose:** make normal divergence and unreliable operations safe.

Major tasks:

- implement `BOTH_CHANGED` direction choice and warnings;
- complete cancellation, timeout, retry, explicit account states, Codex-message pass-through, and local-error presentation;
- enforce file/context/response limits;
- handle incomplete code and external changes during operations;
- harden persistence and recovery.

Dependencies: both directional flows.

Acceptance criteria:

- both-changed never performs an automatic merge;
- the selected side becomes authoritative only after success/approval;
- every injected failure preserves current source and English;
- over-limit files are rejected clearly and non-destructively.

### Phase 6 — Polish, verification, and publishing — release candidate

**Purpose:** prepare an MVP that can be evaluated by real developers.

Major tasks:

- accessibility and keyboard behavior;
- onboarding, privacy disclosure, setup, and troubleshooting text;
- extension-host, contract, and end-to-end test completion;
- if core acceptance is already passing, optionally spike related-test mapping with evidence labels; omit it if results are misleading;
- performance profiling and log review;
- packaging and marketplace metadata;
- manual acceptance certification and pilot feedback plan.

Dependencies: all functional phases.

Release-candidate evidence on 2026-08-23: onboarding/privacy/troubleshooting and platform-limit documentation is complete; the status surface has explicit accessibility information; runtime-returned model and reasoning selection persists per workspace and safely falls back; deterministic and live suites pass 40 tests; and packaging produces a 25-file, 1.63 MiB VSIX with the MIT license and public repository metadata. Related-test mapping was omitted because it remains optional enrichment without a completed precision/reviewability gate. The fresh-profile manual workflow checklist, signed-out-account certification, and Marketplace publisher ownership remain release-owner gates documented in [MVP_RELEASE_CHECKLIST.md](./MVP_RELEASE_CHECKLIST.md).

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
| Schema-valid English is unsupported or internally contradictory | Users trust a structurally valid but false interpretation | Medium–High | `medium` reasoning recommendation, source-supported prompt rules, evidence-linked behavior claims, local deterministic facts, contradiction benchmark, user review | Product-risk blocker if pilot quality is unusable |
| English lacks useful hierarchy or misrepresents code | Users distrust the second surface | Medium–High | Evaluation corpus, prompt/schema iteration, visible staleness, easy Code → English retry, user review | Product-risk blocker if pilot quality is unusable |
| English → Code rewrites too much source | Diffs are hard to trust and may introduce regressions | Medium–High | Include baseline/current source and mappings, request minimal changes, measure diff size, always preview, cancel/retry | No; may block product validation if pervasive |
| Source changes while a request or diff is pending | Stale proposal overwrites newer work | High without controls | Operation IDs, base hashes, document versions, final pre-apply hash check | Yes if not mitigated |
| Source/Markdown watchers form update loops | Repeated state changes or accidental model calls | Medium | One session coordinator, origin/expected-hash tokens, generated-section hash exclusion, model calls only from commands | Yes if destructive; otherwise fix before release |
| Stored mappings become stale | Wrong context or overly broad proposals | High | Treat mappings as hints, validate ranges, hash whole source, regenerate on Code → English | No |
| Optional related tests are missing or misleading, especially E2E candidates | Users or agents trust incorrect navigation hints | Medium | Separate direct/static-path/convention evidence, cap traversal, never claim completeness or regression detection | No; omit the enrichment if it is not trustworthy |
| Incomplete or invalid current syntax reduces interpretation quality | Common editing states fail | High | Best-effort requests, clear retryable error, never replace last good English on failure | No |
| Large/minified files exceed context or stall the extension | Failed calls, latency, resource use | Medium | Byte/line/context/response limits, Phase 0 measurement, clear rejection, no MVP chunking | No |
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

The following are deliberately deferred until implementation evidence exists:

- function-level versus full-file interpretation for files beyond MVP limits;
- stronger source mappings or semantic IR;
- provider and language expansion;
- on-save or idle synchronization;
- whether teams should commit or ignore `.langclarity/` by default;
- orphan retention and cleanup policy beyond preserving deleted-source interpretations;
- optional related-test mapping quality and presentation;
- benchmark corpus ownership, graders, sample size, repeated-run design, baseline thresholds, and pilot recruitment;
- whether a second critic/review call improves fidelity enough to justify its additional latency and usage;
- analytics, accounts, licensing, and backend services;
- a standalone editor.

None is required to begin the MVP.
