import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { InterpretationResult } from '../interpretation';
import type { FidelityScore, LoadedFidelityFixture } from './types';

export interface FidelityRunRecord {
	corpusVersion: string;
	promptVersionExpected: string;
	runId: string;
	startedAt: string;
	finishedAt: string;
	model?: string;
	reasoningEffort?: string;
	includeHeldOut: boolean;
	results: FidelityFixtureResult[];
	summary: {
		fixtures: number;
		deterministicPasses: number;
		lineParityFailures: number;
		mustHaveFailures: number;
		prohibitedFailures: number;
		interpreterErrors: number;
	};
}

export interface FidelityFixtureResult {
	fixtureId: string;
	heldOut: boolean;
	tags: string[];
	sourcePath: string;
	languageId: string;
	sourceHash: string;
	durationMs: number;
	error?: string;
	model?: string;
	score?: FidelityScore;
	document?: InterpretationResult;
	review: {
		status: 'pending-expert-review';
		notes: string;
	};
}

export function summarizeFidelityResults(
	results: FidelityFixtureResult[],
): FidelityRunRecord['summary'] {
	return {
		fixtures: results.length,
		deterministicPasses: results.filter((result) => result.score?.deterministicPass === true).length,
		lineParityFailures: results.filter((result) => result.score && !result.score.lineParity).length,
		mustHaveFailures: results.filter((result) => (
			result.score !== undefined && result.score.mustHavePassed < result.score.mustHaveTotal
		)).length,
		prohibitedFailures: results.filter((result) => (
			result.score !== undefined && result.score.prohibitedPassed < result.score.prohibitedTotal
		)).length,
		interpreterErrors: results.filter((result) => result.error !== undefined).length,
	};
}

export function writeFidelityRunRecord(corpusRoot: string, record: FidelityRunRecord): string {
	const resultsDir = path.join(corpusRoot, 'results');
	mkdirSync(resultsDir, { recursive: true });
	const filePath = path.join(resultsDir, `${record.runId}.json`);
	writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
	return filePath;
}

export function fixtureResultShell(
	fixture: LoadedFidelityFixture,
	sourceHash: string,
	durationMs: number,
): Omit<FidelityFixtureResult, 'error' | 'model' | 'score' | 'document'> {
	return {
		fixtureId: fixture.id,
		heldOut: fixture.heldOut,
		tags: fixture.tags,
		sourcePath: fixture.sourcePath,
		languageId: fixture.languageId,
		sourceHash,
		durationMs,
		review: {
			status: 'pending-expert-review',
			notes: 'Automated pattern scores are evidence only. Blinded expert review still required for product claims.',
		},
	};
}
