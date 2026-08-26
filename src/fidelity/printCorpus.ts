#!/usr/bin/env node
/**
 * Node entry for loading/scoring helpers without a live Codex run.
 * Live interpretation runs use the VS Code test host:
 *   LANGCLARITY_FIDELITY_TEST=1 npm run benchmark:fidelity
 */
import path from 'node:path';
import { corpusRootFromExtensionRoot, loadFidelityFixtures, loadFidelityManifest } from './loadCorpus';

const extensionRoot = path.resolve(__dirname, '..', '..');
const corpusRoot = corpusRootFromExtensionRoot(extensionRoot);
const manifest = loadFidelityManifest(corpusRoot);
const fixtures = loadFidelityFixtures(corpusRoot, { includeHeldOut: true });
const development = fixtures.filter((fixture) => !fixture.heldOut);
const heldOut = fixtures.filter((fixture) => fixture.heldOut);

process.stdout.write(JSON.stringify({
	corpusVersion: manifest.corpusVersion,
	fixtureCount: fixtures.length,
	developmentCount: development.length,
	heldOutCount: heldOut.length,
	heldOutIds: heldOut.map((fixture) => fixture.id),
	developmentIds: development.map((fixture) => fixture.id),
}, null, 2));
process.stdout.write('\n');
