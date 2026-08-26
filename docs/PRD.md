# LangClarity Product Requirements Document

## 1. Document purpose

This document defines the MVP product and interaction requirements for LangClarity. It is intentionally implementation-aware but non-technical. A concise map of the locked architecture and delivery slices is in [High_Level_Tech_Doc.md](./High_Level_Tech_Doc.md). Implementation contracts, workflows, data structures, testing, milestones, and technical risks are specified in [Technical_One_Pager.md](./Technical_One_Pager.md).

## 2. Product definition

LangClarity is a VS Code extension for bidirectional programming between natural English and source code. It gives a source file two persistent, editable representations:

Product domain: `langclarity.com`.

- structured English;
- TypeScript or JavaScript source code.

The developer explicitly synchronizes either representation into the other:

```text
English
   ↕
Codex interpreter
   ↕
Code
```

Both representations are working surfaces. English is not a temporary prompt, a generic explanation, or a chat transcript.

## 3. Problem and product thesis

AI coding tools generally use English as transient input and discard it after generating or modifying code. That prevents English from becoming a durable way to understand and edit a program.

LangClarity tests a different thesis:

> A persistent, editable English representation can become a useful second programming surface alongside source code.

The English representation must retain program-like hierarchy and ordering. For example:

```text
Get the top users
  Keep users who:
    Are active
    Are located in the US
  Sort by score
    Highest first
  Return the first 10
```

It should not degrade into prose such as “This function first retrieves some users and then filters them.”

## 4. Target users

The MVP targets developers who:

- use VS Code;
- work in TypeScript or JavaScript;
- have Codex installed locally and use a ChatGPT/Codex subscription;
- want to understand or modify code through a higher-level representation;
- are comfortable reviewing AI-generated changes before applying them.

## 5. Goals

The MVP must establish whether developers will actually use editable English as a second programming surface. It must:

1. Generate structured English from an open TypeScript or JavaScript file on demand.
2. Persist that English as Markdown under `.langclarity/` in a one-to-one tree matching the source tree.
3. Allow the developer to edit either English or code.
4. Synchronize changes manually and in an explicit direction.
5. Preview and validate AI-proposed code before application.
6. Detect when cached English is stale after source changes.
7. Protect both representations from loss when an operation fails.
8. Keep the architecture small enough to validate the product thesis quickly.

## 6. Non-goals

The MVP does not aim to provide:

- perfect semantic equivalence between English and code;
- logically correct or type-correct AI output guarantees;
- formal verification or a formal semantic intermediate representation;
- continuous or per-keystroke AI synchronization;
- intelligent merging when both representations changed;
- a standalone editor;
- officially supported language modes beyond TypeScript and JavaScript;
- providers other than Codex;
- API-key authentication or LangClarity-hosted inference;
- repository-wide interpretation;
- regression detection, guaranteed-complete test impact analysis, or automatic test execution;
- team accounts, collaboration, cloud sync, billing, or a LangClarity backend.

## 7. Locked MVP decisions

| Area | MVP decision |
| --- | --- |
| Platform | VS Code extension |
| Certified languages | TypeScript and JavaScript; the Codex interpreter is not inherently limited to them |
| Interpreter | Codex only |
| Model selection | Use the Codex runtime default unless the user chooses another runtime-returned model; recommend `medium` reasoning for interpretation when supported |
| Authentication | Existing Codex-managed ChatGPT authentication |
| Codex installation | May be a local prerequisite |
| Invocation | User-initiated; never automatic merely from opening a file |
| Editing | English and code are both editable |
| Synchronization | Manual and directional |
| Both sides changed | User chooses the authoritative side; no merge |
| English storage | Editable Markdown under `.langclarity/`, mirroring the source tree one-to-one |
| Source tracking | Source-content hash plus file identity |
| English → Code safety | Syntax validation, diff review, explicit apply |
| Backend | None unless a concrete requirement appears |

## 8. Core user stories

### Initial interpretation

As a developer, I can open a `.ts`, `.tsx`, `.js`, or `.jsx` file, explicitly open LangClarity’s English view, and request an interpretation so that no AI call occurs until I choose to make one.

### Persistent English

As a developer, I can close and reopen the file or VS Code and recover the last English interpretation without another model call.

### Agent-readable English

As a developer, I can allow a filesystem-capable coding agent to read `.langclarity/` Markdown using the same relative paths as the source tree, without requiring a LangClarity-specific integration.

### English-driven code change

As a developer, I can edit the English representation, request **English → Code**, review the proposed source diff, and apply or cancel it.

### Code-driven English update

As a developer, I can edit source normally, see that English is stale, and request **Code → English** to replace it with an updated interpretation.

### External source changes

As a developer, I can change source through normal editing, Git, another extension, or an external tool and have LangClarity detect divergence rather than assuming it owns the file.

### Related test context (optional / not shipped)

As a future enrichment, a developer may see likely unit, integration, and E2E tests related to the current source file, together with the evidence for each mapping. Today the Related tests section is stubbed empty (`relatedTests: []`) and typically shows “None verified.” This is useful context when available, not a promise of regression detection or a core MVP completion condition.

### Safe failure

As a developer, I keep my current code and English when Codex, parsing, validation, or synchronization fails.

## 9. Primary workflows

### 9.1 First interpretation

```text
Install LangClarity
  → Open a supported source file
  → Run “LangClarity: Open Interpretation”
  → See that no interpretation exists
  → Select “Interpret File”
  → Connect to Codex
  → Complete Codex-managed ChatGPT sign-in if required
  → Receive structured English
  → Store it locally
  → Show English beside code in SYNCED state
```

If Codex is not installed or reachable, LangClarity shows that Codex is required and links to setup instructions. Automatic installation is not required.

### 9.2 English → Code

```text
Edit English
  → State becomes ENGLISH_CHANGED
  → Request English → Code
  → Codex proposes a minimal source change
  → Build a temporary proposed document
  → Validate syntax and collect diagnostics
  → Preview the source diff
  → Apply or Cancel
  → On Apply, regenerate the complete interpretation from the proposed source
  → Atomically apply proposed source and refreshed interpretation
  → Mark SYNCED
```

Invalid syntax blocks ordinary application. TypeScript diagnostics warn but may allow **Apply Anyway**. If the complete interpretation cannot be refreshed after approval, neither document is applied. Cancellation or failure leaves both current representations unchanged.

### 9.3 Code → English

```text
Edit or externally change source
  → State becomes CODE_CHANGED
  → Request Code → English
  → Codex returns structured English
  → Replace cached English only after a valid complete response
  → Update the source hash and mark SYNCED
```

### 9.4 Cached interpretation

```text
Open Interpretation
  → Load cached interpretation
  → Compare cached source hash with current source hash
  → If equal: show current English
  → If different: show cached English as stale and offer Code → English
```

Staleness never triggers an automatic AI request.

### 9.5 Both sides changed

If both representations changed after the last successful synchronization, LangClarity enters `BOTH_CHANGED` and explains that it will not merge the edits. The developer chooses:

- **English → Code**, making English authoritative; or
- **Code → English**, making code authoritative.

Before starting, the UI warns that unsynchronized changes on the losing side may be replaced. Cancel leaves both sides untouched.

## 10. UX and interaction requirements

### 10.1 Entry and onboarding

- Opening a source file alone must not invoke Codex.
- The extension contributes a discoverable **LangClarity: Open Interpretation** command and a source-file context submenu in the editor and Explorer.
- An uninterpreted file shows an empty state with an **Interpret File** action.
- Unsupported file types explain that MVP supports TypeScript and JavaScript.
- Missing Codex, required authentication, and exhausted usage are explicit actionable states. Other failures returned by Codex display Codex's message without LangClarity parsing or reclassifying it.

### 10.2 Two-pane experience

- A LangClarity interpretation pane and the ordinary VS Code source editor should be visible side by side where practical.
- The source remains a normal VS Code document with its existing language services, Git integration, and editor behavior.
- The pane presents English Code as one editable text surface with a VS Code-like gutter containing every source line number. When synchronized, it has exactly one logical English row per source line: row N translates only source line N, blank and punctuation-only structural lines produce blank English rows, and neither side has missing, combined, duplicated, or reordered rows. Generated statements use the shortest clear everyday wording, normally one clause per row. Parent rows and indentation carry context so child rows avoid repetition; readable fragments are allowed. Every meaningful element or property in a multiline declaration retains its own row and visible literal value. Unavoidable technical terms are explained, and identifiers appear only when they aid exact correspondence. Enter inserts an English row and shifts the current and following content and gutter positions down by one.
- The English Code surface is a webview textarea (not a full VS Code text editor with Find or language services). It grows vertically to fit its logical rows so the pane owns vertical scrolling; long rows retain horizontal scrolling. It supports selection, browser undo/redo, clipboard, Tab/Shift+Tab indentation, clickable gutter line navigation, active-line indication, Cmd/Ctrl+S save, and line/column status.
- Every tab uses the pane's full width, grows with its content, and relies on pane-level vertical scrolling. The remaining interpretation sections are grouped into read-only Overview, Structure, and Effects tabs.
- Pane edits modify only the Behavior section of the backing Markdown text document and use normal VS Code dirty, save, and undo behavior.
- The backing Markdown remains directly openable for inspection, interoperability, and repair.
- The view identifies the source file whose English representation is open.
- The interface must not imply that changes are synchronized before a successful explicit operation.

### 10.3 Synchronization controls

- Both **English → Code** and **Code → English** actions must be visible or readily discoverable.
- The interpretation pane displays only the synchronization direction valid for its current state. It displays a neutral direction chooser for `BOTH_CHANGED`, and no synchronization action for `SYNCED` or invalid content.
- Saving changed English or source reveals the corresponding apply action in the interpretation pane. If both changed, the pane reveals an explicit direction chooser.
- The selected direction must be unambiguous in labels, confirmation text, progress, and results.
- MVP does not contribute a `Cmd/Ctrl+Enter` sync keybinding. A future enhancement may bind it when the active pane makes the direction unambiguous.
- MVP does not include on-save, debounce, idle, or per-keystroke AI sync.

### 10.4 Synchronization status

Session sync state is `SYNCED` | `CODE_CHANGED` | `ENGLISH_CHANGED` | `BOTH_CHANGED` | `ERROR` (exact labels may differ). Model operations show VS Code progress (`withProgress`) while they run; there is no separate `INTERPRETING` session state.

| State | Meaning | Expected action |
| --- | --- | --- |
| `SYNCED` | Both sides correspond to the last completed sync | Edit either side |
| `CODE_CHANGED` | Source differs from the last synchronized source | Code → English |
| `ENGLISH_CHANGED` | English differs from its last synchronized version | English → Code |
| `BOTH_CHANGED` | Both sides changed independently | Choose an authoritative side |
| `ERROR` | The last operation failed; saved content remains intact | Inspect error and retry |

Status should be visible without interrupting ordinary editing.

### 10.5 Diff review

- English → Code never silently overwrites source.
- Use VS Code’s diff experience where possible.
- The preview compares the current document with the exact proposed document that would be applied.
- The developer can **Apply** or **Cancel**; **Retry** is optional.
- If the source changes after proposal generation, do not apply the stale proposal. Ask the user to regenerate it.

### 10.6 Loading and errors

- Progress should identify whether LangClarity is interpreting code or proposing code.
- Disable conflicting sync actions while an operation is pending.
- Errors detected by LangClarity use plain language and retain the appropriate next action.
- For a failure returned by Codex, display Codex's returned message unchanged. Do not classify behavior by matching message text. If Codex provides no message, show a generic unknown-Codex-error fallback.
- Cancellation is an operation outcome, not an error. Authentication required and usage limited are account states, not generic errors.
- Incomplete or invalid input may produce a best-effort interpretation, but if no safe complete response can be produced, show a retryable failure.
- Large or generated/minified files beyond MVP limits show a specific unsupported message.

## 11. Functional requirements

### FR-1: Supported documents

LangClarity operates on ordinary, file-backed TypeScript and JavaScript documents, including `.ts`, `.tsx`, `.js`, and `.jsx`. Practical size and context limits may restrict individual files.

### FR-2: On-demand invocation

No interpretation request is made until the developer explicitly asks for one.

### FR-3: Structured English

Code → English output must contain exactly one ordered English Code item per source line. Each item explains only that line in language an everyday person can understand as easily as possible. It uses the shortest unambiguous wording, normally one clause and roughly 12–18 words excluding required literals. Parent rows and indentation carry context, readable fragments are allowed, and repeated subjects or identifiers are omitted when context remains clear. For multiline declarations, the opening row establishes the collection's purpose and every meaningful element or property retains its own row and visible value; group summaries cannot replace those rows. Output preserves visible strings, numbers, booleans, property names, event names, URLs, log labels, and other known values verbatim; leads with meaning rather than syntax; and explains unavoidable technical terms. Blank and punctuation-only structural lines produce empty statements. Higher-level summaries belong outside English Code.

### FR-4: Editable English

English must be an editable document-like surface. Local edits are retained independently until the user synchronizes or intentionally discards them.

### FR-5: Local persistence

Each interpreted source file has one editable Markdown file under `.langclarity/` whose path mirrors the source path while retaining the source extension. For example:

```text
src/users.ts
↕
.langclarity/src/users.ts.md
```

The Markdown file is the persistent English representation, not a derived third editing surface. It contains versioned metadata and predictable sections for purpose, responsibilities, behavior, key definitions, dependencies, related files/tests, side effects, and constraints. LangClarity does not silently add `.langclarity/` to Git ignore rules; teams choose whether these documentation files are version-controlled.

### FR-6: Staleness detection

LangClarity computes a deterministic hash of the synchronized source content. A mismatch with current content marks code changed or the cached interpretation stale.

### FR-7: Manual directional synchronization

The user explicitly requests either English → Code or Code → English. LangClarity does not infer direction from focus when that would be ambiguous.

### FR-8: Conflict handling

When both sides changed, LangClarity does not merge. It requires the user to choose the authoritative side and warns about replacement.

### FR-9: Proposed code review

English → Code produces a complete proposed source document or reliably applicable edits, validates it, and displays a diff before any write.

### FR-10: Validation

For English → Code, syntactically invalid output is blocked. Type or language-service diagnostics are shown as warnings and may be overridden.

### FR-11: Atomic failure behavior

No model response, validation result, or apply failure may partially replace code or English. Existing content remains available after failure.

After English → Code approval, LangClarity regenerates all interpretation sections from the proposed source before applying either document. Purpose, Responsibilities, Behavior, generated structure, Side Effects, and Constraints therefore correspond to the synchronized source when the operation reports success.

### FR-12: External edits

LangClarity observes source-document and filesystem changes and recomputes state. It must distinguish its own applied edit from a new user edit to avoid update loops.

### FR-13: Codex integration

LangClarity uses the official local Codex runtime/app-server mechanisms and Codex-managed ChatGPT authentication. It does not collect passwords, store provider credentials, ask for an OpenAI API key, or pay inference costs.

### FR-14: Privacy disclosure

Before or during initial use, users are told that source submitted for interpretation is processed by Codex/OpenAI under the provider’s policies. Source is not routed through a LangClarity backend in MVP.

### FR-15: Safeguards

LangClarity enforces documented practical file/context limits for model operations and rejects unsupported or unsafe operations without corrupting user work. Existing interpretations remain openable and locally editable when their source exceeds a generation limit.

### FR-16: Error presentation

LangClarity uses one error shape with a `source` of `codex` or `langclarity` and a user-visible message. Codex-originated failures preserve and display the message returned by Codex; LangClarity does not maintain a parallel Codex error taxonomy or infer meaning from message wording. LangClarity supplies messages only for failures it detects itself, such as a missing or incompatible runtime, a local timeout, a protocol failure, or unavailable workspace/source access. Authentication required and usage limited remain explicit account states, and cancellation remains a non-error outcome.

### FR-16: Related-test mapping (optional / post-MVP; stubbed)

Not implemented. `repositoryFacts.relatedTests` is always `[]`, so the generated **Related tests** section renders `_None verified._`.

As optional enrichment after the core POC, LangClarity may later identify related unit, integration, and E2E test files using deterministic evidence where available. Direct imports, bounded static dependency paths, and established test naming/location conventions should be distinguished so the UI does not present every candidate as equally certain.

When shipped, related tests may be shown with the English interpretation and alongside an English → Code proposal so developers and agents can inspect likely coverage. Mapping would be a best-effort enrichment, never described as exhaustive, and is not required to declare the core MVP complete. Regression detection and automatic selection or execution of tests are not MVP goals.

### FR-17: Model selection

LangClarity defaults to the model selected by Codex. If the Codex runtime can enumerate models available to the authenticated account, LangClarity offers those non-hidden models in a selector and stores the chosen model ID as a workspace preference. The extension does not hard-code availability, bypass account restrictions, or fail interpretation merely because the previously selected model is no longer available; it falls back to the current Codex default with a clear notice.

For Code → English, LangClarity recommends `medium` reasoning when the selected model reports that effort as supported. Users may choose another supported effort. The recommendation is based on an initial controlled fixture retest and remains subject to broader benchmark results.

### FR-18: Source preservation

English → Code operates on the current VS Code source buffer, including unsaved edits. It applies the approved result as one undoable editor operation without directly writing or auto-saving the file. The implementation preserves the existing EOL style, BOM/encoding behavior, and unrelated final-newline state, and it does not invoke a formatter as part of synchronization.

### FR-19: Paired-file lifecycle

Creating source does not create English until explicit interpretation. Renaming or moving source moves the paired Markdown and updates local metadata without invoking Codex. Deleting source moves its Markdown to `.langclarity/.orphaned/` rather than silently deleting editable English. Each workspace root owns its own `.langclarity/` tree; untitled and out-of-workspace files are unsupported for MVP.

### FR-20: Direct import relationships

LangClarity resolves direct import and re-export module specifiers locally (`repositoryFacts`) and records them in generated Markdown **Dependencies** and **Related files** sections. Workspace-resolved imports are listed with path and source line; unresolved or external modules are labeled as such. Related files are only directly imported workspace paths—not multi-hop graphs.

**Future / optional:** follow static paths beyond one edge (for example up to four), include connected-file English summaries only when those files already have paired `.langclarity/` Markdown, and label heuristic relationships as candidates. None of that is current behavior. This is not repository-wide automatic interpretation or a semantic graph.

## 12. AI correctness and safety position

The interpreter may misunderstand code or intent. The MVP accepts this in the same way other AI coding tools do. Its safety model is human review rather than formal proof:

```text
English edit
  → AI proposal
  → syntax/diagnostic checks
  → developer reviews source diff
  → explicit apply
```

LangClarity should request minimal code changes and use syntax/AST context where useful, but perfect patch minimality is not an MVP guarantee.

Structured-schema validation establishes shape, not semantic truth. An initial live proof produced a schema-valid sentence that contradicted itself about input mutation. English Code therefore uses exact source-line correspondence, while deterministic facts such as key definitions, imports, exports, and verified paths are derived locally and prompts require source-supported claims, mutation precision, contradiction review, and omission when uncertain. Line correspondence improves reviewability but does not prove a claim is correct.

## 13. Privacy and accounts

- Source flows from the developer’s machine to Codex/OpenAI, not through LangClarity-hosted infrastructure.
- Provider processing is governed by the provider’s policies and should be disclosed clearly.
- `.langclarity/` files are ordinary workspace Markdown and may contain source-derived information. Users decide whether to commit, ignore, share, or delete them.
- Codex owns ChatGPT authentication and token state.
- LangClarity stores neither ChatGPT passwords nor provider refresh tokens.
- LangClarity-specific user accounts are not required.
- No backend is required for authentication, inference, storage, synchronization, or billing.

### 13.1 Cost and usage responsibility

LangClarity does not operate an inference service or pay per-request model costs. Developers authenticate through their own Codex-managed ChatGPT account, and LangClarity requests consume that account’s included usage limits or credits. If usage is exhausted, LangClarity reports the Codex error and does not automatically purchase credits, request an API key, switch authentication methods, or fall back to LangClarity-funded inference. Current code and English remain unchanged, and the user may retry when Codex access is available again.

This distinction is supported by official OpenAI documentation: ChatGPT authentication uses subscription access, while API-key authentication uses standard API billing. See [Codex authentication](https://learn.chatgpt.com/docs/auth) and [Codex pricing](https://learn.chatgpt.com/docs/pricing).

Product and marketing language must not describe Codex as “free.” The accurate MVP claim is:

> LangClarity has no variable inference cost; usage belongs to the developer’s Codex entitlement.

## 14. MVP acceptance criteria

The MVP is acceptable when all of the following are demonstrated end to end:

1. A developer installs the extension and opens a supported source file without triggering an AI call.
2. The developer opens the English view and interprets that file on demand.
3. Missing Codex and required Codex sign-in each produce an actionable state.
4. The returned English is structured, ordered, editable, and associated with the correct source file.
5. The interpretation is stored at the expected one-to-one `.langclarity/<source-path-and-extension>.md` path and survives restart without a new model call.
6. Editing English moves the document to an English-changed state.
7. English → Code produces a source diff and never writes before explicit approval.
8. Syntactically invalid proposals are not applied; type diagnostics are disclosed.
9. Applying an approved proposal changes the intended source document and returns both sides to synchronized state.
10. Editing source manually or externally marks the English representation stale/code-changed.
11. Code → English refreshes English and the source hash, returning to synchronized state.
12. Changing both sides requires an explicit authoritative-direction choice and performs no intelligent merge.
13. Failed or cancelled model calls, validation, previews, and applies preserve existing code and English.
14. Renaming or moving a source file moves its paired Markdown file; deleting a source file preserves its editable English in an orphaned area rather than silently destroying it.
15. If runtime model enumeration is available, the selector shows only runtime-returned non-hidden models and safely falls back when a selection becomes unavailable.
16. Unsupported languages and over-limit files fail with clear, non-destructive guidance.
17. No source is routed through a LangClarity backend and no API key is requested.
18. Direct imports are locally resolved into Dependencies / Related files; multi-hop paths, paired-file summaries, and heuristic candidates are not current behavior and must not be presented as shipped facts or used to trigger automatic interpretation.
19. Exhausted Codex usage preserves source and English, reports an actionable usage-limited state, and never triggers an automatic purchase, API-key request, authentication change, or LangClarity-funded fallback.

## 15. Success criteria for product validation

Acceptance proves the software works; the product thesis additionally requires real usage. During MVP evaluation, measure locally or through explicitly consented, privacy-preserving feedback:

- whether users reopen existing English representations;
- whether they edit English and complete English → Code flows;
- whether they refresh English after code changes;
- apply versus cancel rates for proposed changes;
- common failure and retry reasons;
- qualitative reports that English improves comprehension or editing.

No numeric adoption threshold is locked before a pilot population and observation period are defined. Product validation should focus on repeated voluntary use, not the raw number of generated interpretations.

## 16. Benchmark plan

### 16.1 Purpose

Benchmarks must determine whether LangClarity measurably improves code understanding and change quality rather than merely producing explanations that sound useful. “Accuracy” is divided into three testable outcomes:

1. **Interpretation fidelity:** Does the English accurately represent the source?
2. **Human comprehension:** Does the English help a developer understand unfamiliar code more accurately or quickly?
3. **Agent effectiveness:** Does the English help an AI coding agent answer questions, find connected files, or make correct changes?

Benchmark results are evaluation evidence, not a guarantee that an individual interpretation is correct.

### 16.2 Evaluation corpus

Maintain a versioned benchmark corpus containing representative TypeScript and JavaScript files and small connected-file scenarios. Include:

- functions, classes, modules, asynchronous control flow, and error handling;
- imports, exports, shared types, and cross-file calls;
- optionally, direct unit tests, statically reachable integration tests, and convention-based E2E candidates when test mapping is under evaluation;
- straightforward and intentionally non-obvious business rules;
- different file sizes and complexity levels within MVP limits;
- incomplete or invalid source examples for failure behavior;
- expert-authored reference facts for purpose, behavior, key definitions, relationships, side effects, and constraints.

Keep a held-out portion that is not used for prompt/schema iteration. Record the source revision, prompt/schema version, interpreter version, and evaluation rubric with every result so regressions can be compared meaningfully.

### 16.3 Interpretation-fidelity benchmark

Score generated English against the source and reference facts for:

- factual claim precision: statements supported by the source;
- behavior coverage: important reference facts represented;
- key definition accuracy: correct names and responsibilities;
- relationship accuracy: correct imports, dependencies, and connected files;
- when optional test mapping is evaluated, related-test precision and recall scored separately by direct, static-path, and convention evidence;
- hierarchy/order accuracy: control flow appears in the correct structure and sequence;
- unsupported-claim rate: claims that cannot be established from available code;
- internal-contradiction rate, including conflicting claims across behavior and side-effect sections;
- source-line correspondence and whether each English row is supported by its paired source line;
- staleness behavior: an interpretation is never presented as current after its source hash changes.

Expert review is the initial grading method. Deterministic checks should grade paths, key definitions, mappings, hashes, and relationships where possible.

### 16.4 Human-comprehension benchmark

Compare two conditions on unfamiliar code, balancing task order and file difficulty across participants:

```text
Baseline: source code only
Treatment: source code plus LangClarity English
```

Measure:

- correctness on factual comprehension questions;
- time to produce an accurate file summary;
- success and time when locating relevant connected files;
- success and time on a small code-change task;
- confidence calibration: whether confidence matches correctness;
- corrections required after reviewing the source.

Collect qualitative feedback separately so perceived clarity does not substitute for correctness.

### 16.5 Agent-effectiveness benchmark

Run the same agent/model and prompts in isolated sessions under two conditions:

```text
Baseline: source code and normal repository tools
Treatment: the same inputs plus the matching `.langclarity/` Markdown context
```

Evaluate:

- codebase comprehension-question accuracy;
- relevant-file retrieval precision and recall;
- relevant-test retrieval precision and recall;
- key definition and dependency identification accuracy;
- edit localization: whether the agent changes the correct files and regions;
- behavioral task success using deterministic tests where available;
- syntax/type/test pass rates;
- unrelated diff size and unnecessary file reads;
- unsupported assertions about code behavior;
- time, model calls, and token/context usage.

The benchmark must hold the underlying model, task instructions, repository revision, and available tools constant. Only LangClarity context changes between baseline and treatment.

### 16.6 English → Code quality benchmark

For a versioned set of English edits, record:

- requested behavior implemented correctly;
- syntax validation pass rate;
- type and test pass rates;
- minimality of the resulting diff;
- preservation of unrelated behavior;
- proposal apply, cancel, and retry outcomes during user testing.

Compilation or test success alone is insufficient; task-specific assertions must verify the intended behavior.

### 16.7 Operational measures

Track locally during benchmark runs:

- interpretation and proposal latency;
- request and response size;
- schema-validation failure rate;
- retry and cancellation rate;
- stale-response rejection;
- cache hit rate;
- model/context usage where the Codex runtime exposes it.

Do not collect source, English, prompts, or benchmark participant data through product telemetry without explicit consent and a documented retention policy.

### 16.8 Decision rules

- Establish and publish the baseline before setting improvement thresholds.
- Report sample size, task mix, central results, and uncertainty; do not rely on a single average.
- LangClarity should show a repeatable improvement in at least one primary comprehension/effectiveness measure without a material correctness regression in another.
- No product claim about improved understanding or accuracy should be made from qualitative feedback alone.
- Re-run the held-out benchmark after material prompt, schema, mapping, or interpreter changes.
- Treat regressions in data safety, stale-state handling, or unauthorized source modification as release blockers regardless of average benchmark improvement.

### 16.9 Language expansion gate

Codex can attempt to interpret many programming and scripting languages, so the interpreter boundary should carry a general language identifier rather than encode TypeScript/JavaScript assumptions. Official LangClarity language support remains narrower because bidirectional editing also requires language-aware parsing, source mappings, syntax validation, fixtures, and failure behavior.

A language beyond TypeScript/JavaScript becomes officially supported only after it has:

1. a representative held-out corpus and expert reference facts;
2. a reliable parser/validator integration or a documented reduced-safety mode;
3. passing Code → English, English → Code, staleness, and failure benchmarks;
4. quality that is not materially worse than the published MVP baseline;
5. clear user-facing support and limitation documentation.

Best-effort interpretation of an uncertified language may be explored later, but it must be labeled experimental and must not imply the same validation guarantees.

### 16.10 Open benchmark items

The benchmark plan does not block building the proof of concept. Before using benchmark results for product claims, define:

- who owns and versions the corpus and expert reference facts;
- reviewer qualifications and disagreement resolution;
- participant count, task allocation, and pilot recruitment;
- the primary measure and minimum meaningful improvement threshold;
- treatment of optional related-test mapping when it is not shipped;
- privacy, consent, retention, and reporting rules for participant data.

Start with a small internal baseline after the core two-direction workflow works, then refine the design before a broader pilot. Do not invent numeric success thresholds before baseline variance is observed.

The first quality retest used one file and one run per variant. A follow-up bounded corpus used six fixtures and 12 medium-effort calls. Both baseline and evidence-linked variants covered all 27 expert-authored facts with no detected prohibited claims or contradictions; the evidence-linked variant added 25 structurally valid source ranges while averaging 37% more latency. This supports evidence links for traceability, not a claim of improved factual accuracy.

A versioned **12-fixture** interpretation fidelity corpus now lives under `benchmarks/fidelity/` and is runnable via `npm run benchmark:fidelity` (see that folder’s README). The next benchmark steps are repeated, randomized or rotated runs on that corpus (and any later expansions), expert-authored must-have and prohibited claims with retained raw outputs, and blinded semantic review. Comparisons should isolate effort, prompt rules, evidence schema, and connected-file/test context. Evidence grading must assess whether a cited range actually supports its claim, not merely whether the range is in bounds. A second critic/review model call remains deferred until those results show that its quality gain justifies added latency and usage.

## 17. Explicitly out of scope

- Standalone LangClarity editor.
- Officially supported Python, Go, Java, Rust, or other additional-language modes before they pass the language-expansion gate.
- Claude, Grok, local-model, API-key, or provider marketplace support.
- LangClarity-hosted inference or billing.
- Continuous, automatic, idle, debounce, or on-save model synchronization.
- Intelligent three-way merging of English and code.
- Formal semantic IR or persistent one-to-one AST node identity.
- Guaranteed logical or type correctness.
- Real-time collaboration, teams, organizations, or cloud sync.
- automatic semantic resolution of Git conflicts in `.langclarity/` Markdown.
- Full-repository interpretation and automatic interpretation of opened files.
- Guaranteed-complete test impact analysis or automatic test execution.
- LangClarity model training or fine-tuning.

## 18. Future possibilities

Future work may include more languages or interpreters, automatic sync modes, stronger AST mappings, semantic IR, English autocomplete and diagnostics, an MCP/query interface over `.langclarity/`, English-based review/debugging, repository navigation, test execution, and a standalone editor. These possibilities may influence an MVP boundary only when isolation is cheap; they do not justify speculative abstractions now.

Post-MVP, consider a **Reconcile Both** workflow for `BOTH_CHANGED`. It would use the current code, current English, and a trustworthy common ancestor to propose a mutually consistent code-and-English pair. The user must review both diffs, and neither side should be applied until the complete pair is approved. Because the MVP persists synchronized hashes rather than full prior snapshots, LangClarity cannot currently reconstruct each side's independent edits; without a stored baseline or a suitable Git ancestor, this workflow must not claim to preserve both sets of changes.
