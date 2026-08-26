import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { CodexInterpreter } from '../codexInterpreter';
import {
	corpusRootFromExtensionRoot,
	loadFidelityFixtures,
	loadFidelityManifest,
} from '../fidelity/loadCorpus';
import {
	fixtureResultShell,
	summarizeFidelityResults,
	writeFidelityRunRecord,
	type FidelityFixtureResult,
} from '../fidelity/runRecord';
import { scoreInterpretation } from '../fidelity/scoreInterpretation';
import { hashText } from '../hash';

suite('Fidelity corpus live runs', () => {
	test('interprets development fixtures and retains scored outputs', async function () {
		if (process.env.LANGCLARITY_FIDELITY_TEST !== '1') {
			this.skip();
		}
		this.timeout(30 * 60_000);

		const extensionRoot = path.join(__dirname, '..', '..');
		const corpusRoot = corpusRootFromExtensionRoot(extensionRoot);
		const manifest = loadFidelityManifest(corpusRoot);
		const includeHeldOut = process.env.LANGCLARITY_FIDELITY_HELD_OUT === '1';
		const fixtures = loadFidelityFixtures(corpusRoot, { includeHeldOut });
		assert.ok(fixtures.length >= 9);

		const interpreter = new CodexInterpreter();
		const cancellation = new vscode.CancellationTokenSource();
		const startedAt = new Date().toISOString();
		const results: FidelityFixtureResult[] = [];
		const workspacePath = path.join(corpusRoot, 'fixtures');

		try {
			for (const fixture of fixtures) {
				const started = Date.now();
				const sourceHash = hashText(fixture.source);
				try {
					const interpreted = await interpreter.codeToEnglish({
						source: fixture.source,
						sourcePath: fixture.sourcePath,
						languageId: fixture.languageId,
						workspacePath,
						cancellationToken: cancellation.token,
						modelPreference: process.env.LANGCLARITY_FIDELITY_MODEL
							? { modelId: process.env.LANGCLARITY_FIDELITY_MODEL }
							: {},
					});
					const score = scoreInterpretation(
						fixture.id,
						fixture.source,
						interpreted.document,
						fixture.claims,
					);
					results.push({
						...fixtureResultShell(fixture, sourceHash, Date.now() - started),
						model: interpreted.model,
						score,
						document: interpreted.document,
					});
				} catch (error) {
					results.push({
						...fixtureResultShell(fixture, sourceHash, Date.now() - started),
						error: error instanceof Error ? error.message : 'Unknown interpreter error.',
					});
				}
			}
		} finally {
			cancellation.dispose();
			interpreter.dispose();
		}

		const finishedAt = new Date().toISOString();
		const record = {
			corpusVersion: manifest.corpusVersion,
			promptVersionExpected: manifest.promptVersionExpected,
			runId: `${finishedAt.replaceAll(':', '').replace(/\.\d+Z$/u, 'Z')}-${randomUUID().slice(0, 8)}`,
			startedAt,
			finishedAt,
			includeHeldOut,
			results,
			summary: summarizeFidelityResults(results),
		};
		const outputPath = writeFidelityRunRecord(corpusRoot, record);
		assert.ok(outputPath.endsWith('.json'));
		assert.strictEqual(record.summary.fixtures, fixtures.length);

		// Live runs retain outputs even when some fixtures fail. Do not assert a perfect
		// deterministicPass rate — corpus scoring is evidence for review, not a release gate yet.
		assert.ok(
			record.summary.interpreterErrors < fixtures.length,
			`Every fixture failed before scoring. See ${outputPath}`,
		);
	});
});
