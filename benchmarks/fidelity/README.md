# Interpretation fidelity corpus

Versioned 12-file Code → English benchmark for LangClarity. Automated pattern scores are **evidence for review**, not proof that an interpretation is correct. Product claims still need blinded expert review (see `docs/PRD.md` §16).

## Layout

- `manifest.json` — corpus version, `promptVersionExpected`, description, fixture list (each with `id` + `tags`), held-out IDs
- `fixtures/<id>/source.*` — source under MVP size limits (optional companion files may exist; only `sourceFile` from claims is scored)
- `fixtures/<id>/claims.json` — expert must-have and prohibited claim patterns
- `results/` — retained live-run JSON (gitignored)

Held-out fixtures (not for prompt iteration): `06-incomplete`, `08-react-button`, `12-nested-loops`.

## Deterministic scoring

For each interpretation, the scorer:

1. Checks behavior **line parity** (one row per source line, consecutive `sourceLine`).
2. Searches purpose + responsibilities + behavior + side effects + constraints.
3. Marks each **must-have** claim pass only if **all** of its regex patterns match.
4. Marks each **prohibited** claim pass only if **none** of its patterns match.

Patterns may start with `(?i)` for case-insensitive matching (JavaScript RegExp has no inline `(?i)` flag; the scorer strips it and applies the `iu` flags).

`deterministicPass` requires line parity plus all must-have and prohibited claims passing.

Improvements after prompt changes are **not certain** until you re-run and compare retained results.

## Commands

List corpus (no Codex):

```bash
npm run corpus:fidelity
```

Equivalent: `npm run compile && node out/fidelity/printCorpus.js`.

`npm run benchmark:fidelity` always runs the deterministic scoring suite (`Fidelity corpus scoring`). The live Codex suite (`Fidelity corpus live runs`) skips unless `LANGCLARITY_FIDELITY_TEST=1`.

Live development set (requires signed-in Codex):

```bash
LANGCLARITY_FIDELITY_TEST=1 npm run benchmark:fidelity
```

Include held-out fixtures:

```bash
LANGCLARITY_FIDELITY_TEST=1 LANGCLARITY_FIDELITY_HELD_OUT=1 npm run benchmark:fidelity
```

Optional model pin: `LANGCLARITY_FIDELITY_MODEL=<runtime-model-id>`.

Each live run writes `results/<runId>.json` with a run summary, per-fixture records (tags, `sourceHash`, score, raw document, timings), and a `pending-expert-review` marker.

## Adding a fixture

1. Add `fixtures/<id>/source.ts` (or `.js` / `.tsx`) and `claims.json`. Optional companion files (e.g. `10-imports-local` has `math.ts`) are fine; only the file named in `claims.sourceFile` is loaded and scored.
2. `claims.json` must include:
   - `id` — must equal the fixture id (and the `manifest.json` entry)
   - `languageId` — e.g. `typescript`, `javascript`
   - `sourceFile` — filename under the fixture dir (e.g. `source.ts`)
   - `mustHave` / `prohibited` — arrays of claim objects, each with `id`, `description`, and `patterns` (RegExp source strings; all patterns AND for must-have, none for prohibited)
3. Register the id in `manifest.json` with `tags` (`heldOutIds` if held out).
4. Keep files within MVP limits (75 KiB / 2,000 lines).
5. Prefer everyday-language patterns that target meaning, not one exact sentence.
