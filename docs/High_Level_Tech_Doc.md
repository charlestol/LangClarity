# LangClarity High-Level Technical Design

## Purpose

LangClarity is a local VS Code extension that gives a TypeScript or JavaScript source file a persistent, editable English interpretation. The interpretation is ordinary Markdown under a `.langclarity/` tree that mirrors the source tree, making it directly readable by a developer new to the codebase and by filesystem-capable coding agents.

This document is the concise architecture map for the MVP. It records the boundaries, major components, core flows, invariants, delivery order, and current proof status. Implementation contracts, detailed workflows, state derivation, validation, testing, risks, and release gates are maintained in [Technical_One_Pager.md](./Technical_One_Pager.md).

```text
src/users.ts ↔ .langclarity/src/users.ts.md
        ↕              ↕
  native editor   interpretation pane
        └──── Codex interpreter ────┘
```

The proof-of-concept question is whether durable English improves practical understanding and can safely drive reviewed code changes. It is not a compiler, chat panel, or promise of perfect equivalence.

## Locked MVP boundaries

| Area | Decision |
| --- | --- |
| Host | Desktop VS Code extension |
| Certified languages | TypeScript and JavaScript; Codex itself is not language-limited |
| AI | Codex only |
| Auth | Codex-managed ChatGPT authentication; no API keys |
| Invocation | Explicit user action; opening files never invokes AI |
| English editor/storage | Interpretation pane backed by Markdown under `.langclarity/`, one-to-one with source paths |
| Model choice | Codex default plus non-hidden models returned by the runtime; recommend `medium` reasoning for interpretation |
| Synchronization | Manual and directional only |
| Conflict | If both sides changed, the user chooses the winner; no merge |
| Safety | Syntax validation, diagnostics warning, exact diff, explicit apply |
| Infrastructure | No LangClarity backend or account |

LangClarity never silently changes `.gitignore`; after the first interpretation it offers an explicit action to ignore `.langclarity/`, and each team decides whether the folder is private, ignored, or version-controlled.

## Core experience

1. Open or right-click a supported source file and run **LangClarity: Open Interpretation**.
2. If no paired Markdown exists, explicitly select **Interpret File**.
3. LangClarity asks Codex for schema-conforming English and renders it into predictable Markdown sections.
4. Edit code in the native editor or any source-line Behavior row in the interpretation pane's single text surface; raw Markdown remains directly openable.
5. **Code → English** refreshes the Markdown after an explicit request.
6. **English → Code** creates a proposed source document, validates it, and opens an exact diff.
7. After explicit approval, LangClarity regenerates every interpretation section from the proposed source and atomically applies both documents; it does not auto-save source.

Conceptual states are `SYNCED`, `CODE_CHANGED`, `ENGLISH_CHANGED`, `BOTH_CHANGED`, `INTERPRETING`, and `ERROR`. Separate source and editable-English hashes derive state. Locally generated relationship/test evidence has its own revision hash so refreshing it does not impersonate a user English edit.

## Architecture

```text
VS Code commands, CodeLens, and status
                   │
                   ▼
Interpretation pane ─ Session/state coordinator ─ Native source document
      │                    │                         │
.langclarity tree          ├── Markdown schema      ├── TS/JS validation
                           ├── hashes/mappings      └── diff/WorkspaceEdit
                           ▼
                    Codex app-server
                           │
                           ▼
                 Codex-managed ChatGPT auth
```

Suggested modules are the extension entry point, Markdown-backed interpretation view, path/Markdown repository, file-session coordinator, source adapter, TS/JS parser/validator, `CodexInterpreter`, proposal/diff coordinator, and redacted logger. The interpretation view uses VS Code's custom text-editor API without a UI framework or hidden content store. Do not add a provider marketplace, semantic IR, or backend for the POC.

## Detailed-design map

| High-level topic | Deeper implementation reference |
| --- | --- |
| Principles, assumptions, and validated Codex findings | [Design principles and assumptions](./Technical_One_Pager.md#2-design-principles) |
| Runtime topology and module responsibilities | [System context](./Technical_One_Pager.md#4-system-context) and [major components](./Technical_One_Pager.md#5-major-components) |
| Codex lifecycle, authentication, models, and error handling | [Codex runtime and authentication](./Technical_One_Pager.md#6-codex-runtime-and-authentication) |
| Markdown schema, evidence, mappings, and related tests | [English representation](./Technical_One_Pager.md#7-english-representation) |
| Persisted/runtime data and synchronization states | [Data model](./Technical_One_Pager.md#8-data-model) and [state transitions](./Technical_One_Pager.md#9-state-derivation-and-transitions) |
| Code → English and English → Code workflows | [Detailed flows](./Technical_One_Pager.md#10-detailed-flows) |
| Validation, file lifecycle, persistence, and recovery | [Diff generation and validation](./Technical_One_Pager.md#11-diff-generation-and-validation), [file changes](./Technical_One_Pager.md#12-file-change-detection-and-loop-prevention), and [persistence](./Technical_One_Pager.md#13-persistence-and-recovery) |
| Limits, security, performance, and extensibility | [Operational constraints](./Technical_One_Pager.md#14-large-generated-and-incomplete-files) |
| Test coverage and Codex contract proof | [Testing strategy](./Technical_One_Pager.md#18-testing-strategy) |
| Delivery phases, risks, gates, and deferrals | [Implementation plan](./Technical_One_Pager.md#19-implementation-plan), [risk register](./Technical_One_Pager.md#20-technical-risk-register), and [release gates](./Technical_One_Pager.md#21-release-gates) |

## Infrastructure and cost

The MVP has no LangClarity backend and no database. Durable English is stored as Markdown in `.langclarity/`; non-content preferences use VS Code workspace state; pending proposals remain in memory; credentials remain owned by Codex. Requested source flows directly from the local Codex runtime to OpenAI.

LangClarity does not operate or pay for inference. Requests consume the developer’s Codex-managed ChatGPT usage limits or credits. If usage is exhausted, LangClarity preserves code and English, reports the Codex limit, and does not purchase credits, request an API key, change authentication methods, or fall back to LangClarity-funded inference. The accurate product claim is: **LangClarity has no variable inference cost; usage belongs to the developer’s Codex entitlement.**

Error handling stays intentionally small. Authentication required and usage limited are explicit account states, and cancellation is a non-error outcome. Every other failure returned by Codex is one `codex` error whose returned message is displayed unchanged; LangClarity does not parse or reclassify Codex message text. Failures detected locally—such as a missing/incompatible runtime, timeout, protocol failure, or unavailable workspace/source—use one `langclarity` error shape with an actionable extension-owned message. All outcomes preserve current source and English.

## English document contract

Each Markdown file uses versioned frontmatter containing the source path/hash, editable-English hash, language, prompt version, model, and interpretation time. Predictable sections cover purpose, responsibilities, behavior, key definitions, dependencies, related files/tests, side effects, and constraints.

The model returns structured data with exactly one ordered English Code item per source line; LangClarity validates exact line-count and line-number parity before rendering Markdown. Each item uses the shortest clear everyday wording supported by its paired source line. Parent rows and indentation carry context to avoid repetition, while visible literal values remain verbatim. The Markdown is canonical after creation, including edits made by another coding agent. Key definitions, imports, exports, verified paths, and optional test relationships are derived locally and placed in generated sections instead of being trusted as model claims. Stable AST identity is not required.

## Safety and lifecycle invariants

- Model output cannot directly mutate source or current Markdown.
- Failed, cancelled, malformed, or stale operations preserve both files.
- Source apply is rejected if its base buffer changed after proposal generation.
- Apply uses one undoable `WorkspaceEdit`, preserving current EOL/BOM/final-newline behavior and unsaved-buffer state.
- Source rename/move moves the paired Markdown and updates local metadata.
- Source deletion preserves English under `.langclarity/.orphaned/` instead of destroying it.
- Each multi-root workspace folder owns its own `.langclarity/`; untitled/out-of-workspace files are unsupported.

## Proof before development — passed

On 2026-08-22, Codex CLI `0.148.0-alpha.15` passed the disposable-workspace protocol proof: stdio initialization, existing ChatGPT auth detection, six dynamically enumerated visible models, schema-valid turns in both directions, read-only/no-approval operation, cancellation, restart, missing-runtime handling, and zero fixture writes. Login initiation/cancellation still needs a later signed-out-account check; the existing authenticated path passed.

The app-server remains explicitly experimental. Generate/contract-test protocol types against the tested minimum version, reject incompatible versions, and never hard-code the observed model catalog. The initial minimum-version rejection used a simulated older version and should later be certified against a real older binary when practical.

The first live response also proved that schema-valid output can still be semantically wrong: it contradicted itself about whether an input array was mutated. A controlled one-fixture retest found that the same runtime-default model at `medium` reasoning removed the observed contradiction. A subsequent six-fixture, 12-call medium-effort corpus found both baseline and evidence-linked prompts covered all 27 expert-authored facts with no detected prohibited claims or contradictions. The evidence-linked version added 25 structurally valid source ranges but averaged 37% more latency. Current evidence supports `medium` plus evidence links for reviewability; it does not show that the richer prompt improves factual accuracy. Do not add a second critic call yet.

## Starting operational defaults

- Maximum source: 75 KiB or 2,000 lines, whichever comes first.
- Static dependency path: four edges.
- Concurrency: one request per file, two globally.
- Slow notice: 30 seconds; hard timeout: three minutes.
- Maximum structured response: 2 MiB.

These are code defaults for the POC, not user settings, and can change after measurement.

## Delivery slices

1. Completed Codex protocol/auth/model proof.
2. Official TypeScript VS Code scaffold with npm and the unbundled default, then initial Code → English Markdown.
3. Markdown lifecycle, hashing, and stale-state detection.
4. English → Code proposal, validation, diff, and apply.
5. Code → English refresh and both-changed authority choice.
6. Failure hardening, size limits, verification, and publishing.

Related-test mapping is optional enrichment: start with direct imports, TypeScript-resolved paths up to four edges, common `*.test.*`/`*.spec.*`/`__tests__` conventions, and labeled Playwright/Cypress candidates. It is documentation/navigation help, not regression detection and not an MVP release gate.

## Open, non-blocking items

- Whether `.langclarity/` should be committed or ignored for a given team.
- Orphan retention/cleanup and advanced relinking UX.
- Benchmark corpus ownership, expert graders, participant count, baseline thresholds, and pilot recruitment.
- Whether a second critic/review call earns its added latency and usage on the larger repeated corpus.
- Precision/recall requirements and UI for optional connected-test mapping.

Product requirements and acceptance criteria are in [PRD.md](./PRD.md). Implementation contracts, workflows, proof steps, testing, risks, and release gates are in [Technical_One_Pager.md](./Technical_One_Pager.md).
