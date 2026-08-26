# Interpretation fidelity corpus

Versioned 12-file Code → English benchmark for LangClarity. Automated pattern scores are **evidence for review**, not proof that an interpretation is correct. Product claims still need blinded expert review (see `docs/PRD.md` §16).

## Layout

- `manifest.json` — corpus version, fixture list, held-out IDs
- `fixtures/<id>/source.*` — source under MVP size limits
- `fixtures/<id>/claims.json` — expert must-have and prohibited claim patterns
- `results/` — retained live-run JSON (gitignored)

Held-out fixtures (not for prompt iteration): `06-incomplete`, `08-react-button`, `12-nested-loops`.

## Deterministic scoring

For each interpretation, the scorer:

1. Checks behavior **line parity** (one row per source line, consecutive `sourceLine`).
2. Searches purpose + responsibilities + behavior + side effects + constraints.
3. Marks each **must-have** claim pass only if **all** of its regex patterns match.
4. Marks each **prohibited** claim pass only if **none** of its patterns match.

Patterns may start with `(?i)` for case-insensitive matching (JavaScript RegExp has no inline `(?i)` flag; the scorer strips it and applies the `i` flag).

`deterministicPass` requires line parity plus all must-have and prohibited claims passing.

Improvements after prompt changes are **not certain** until you re-run and compare retained results.

## Commands

List corpus (no Codex):

```bash
npm run compile && node out/fidelity/printCorpus.js
```

Live development set (requires signed-in Codex):

```bash
LANGCLARITY_FIDELITY_TEST=1 npm run benchmark:fidelity
```

Include held-out fixtures:

```bash
LANGCLARITY_FIDELITY_TEST=1 LANGCLARITY_FIDELITY_HELD_OUT=1 npm run benchmark:fidelity
```

Optional model pin: `LANGCLARITY_FIDELITY_MODEL=<runtime-model-id>`.

Each live run writes `results/<runId>.json` with raw structured documents, per-claim scores, timings, and a `pending-expert-review` marker.

## Adding a fixture

1. Add `fixtures/<id>/source.ts` (or `.js` / `.tsx`) and `claims.json`.
2. Register the id in `manifest.json` (`heldOutIds` if held out).
3. Keep files within MVP limits (75 KiB / 2,000 lines).
4. Prefer everyday-language patterns that target meaning, not one exact sentence.
