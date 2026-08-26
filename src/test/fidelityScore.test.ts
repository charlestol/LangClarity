import * as assert from 'node:assert';
import path from 'node:path';
import {
	corpusRootFromExtensionRoot,
	loadFidelityFixtures,
	loadFidelityManifest,
} from '../fidelity/loadCorpus';
import { scoreInterpretation } from '../fidelity/scoreInterpretation';
import type { InterpretationResult } from '../interpretation';

suite('Fidelity corpus scoring', () => {
	const corpusRoot = corpusRootFromExtensionRoot(path.join(__dirname, '..', '..'));

	test('loads 12 fixtures with a held-out split', () => {
		const manifest = loadFidelityManifest(corpusRoot);
		const fixtures = loadFidelityFixtures(corpusRoot, { includeHeldOut: true });
		assert.strictEqual(manifest.corpusVersion, '1');
		assert.strictEqual(fixtures.length, 12);
		assert.deepStrictEqual(
			fixtures.filter((fixture) => fixture.heldOut).map((fixture) => fixture.id).sort(),
			['06-incomplete', '08-react-button', '12-nested-loops'],
		);
		assert.strictEqual(loadFidelityFixtures(corpusRoot, { includeHeldOut: false }).length, 9);
	});

	test('scores must-have and prohibited claims against structured English', () => {
		const [fixture] = loadFidelityFixtures(corpusRoot, { includeHeldOut: false })
			.filter((entry) => entry.id === '02-greeting');
		assert.ok(fixture);
		const good: InterpretationResult = {
			purpose: 'Build a Hello greeting for a name.',
			responsibilities: ['Return Hello with the name.'],
			behavior: fixture.source.split(/\r\n|\r|\n/u).map((line, index) => ({
				sourceLine: index + 1,
				statement: line.includes('Hello')
					? 'Give back Hello with the name.'
					: line.trim().length === 0 ? '' : 'Continue the greeting helper.',
			})),
			sideEffects: [],
			constraints: [],
		};
		const pass = scoreInterpretation(fixture.id, fixture.source, good, fixture.claims);
		assert.strictEqual(pass.deterministicPass, true);

		const bad: InterpretationResult = {
			...good,
			behavior: good.behavior.map((item) => ({
				...item,
				statement: item.statement || 'Fetch the name from a database over http.',
			})),
			purpose: 'Fetch names from a database.',
		};
		const fail = scoreInterpretation(fixture.id, fixture.source, bad, fixture.claims);
		assert.strictEqual(fail.deterministicPass, false);
		assert.ok(fail.prohibited.some((claim) => claim.id === 'no-network' && claim.outcome === 'fail'));
	});

	test('requires exact behavior line parity', () => {
		const [fixture] = loadFidelityFixtures(corpusRoot, { includeHeldOut: false })
			.filter((entry) => entry.id === '02-greeting');
		assert.ok(fixture);
		const document: InterpretationResult = {
			purpose: 'Hello greeting for a name.',
			responsibilities: ['Return Hello with the name.'],
			behavior: [{ sourceLine: 1, statement: 'Say Hello with the name.' }],
			sideEffects: [],
			constraints: [],
		};
		const score = scoreInterpretation(fixture.id, fixture.source, document, fixture.claims);
		assert.strictEqual(score.lineParity, false);
		assert.strictEqual(score.deterministicPass, false);
	});
});
