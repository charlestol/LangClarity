import * as assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	deriveSyncState,
	parseEnglishDocument,
} from '../englishDocument';
import { hashText, renderInterpretation, type InterpretationResult } from '../interpretation';
import { validateProposalRefresh } from '../proposalCoordinator';
import { syncCommandForState } from '../sessionCoordinator';

const result: InterpretationResult = {
	purpose: 'Return a greeting.',
	responsibilities: ['Create a greeting.'],
	behavior: [{
		statement: 'Return the greeting.',
		sourceLine: 1,
	}],
	sideEffects: [],
	constraints: [],
};

function rendered(): string {
	return renderInterpretation({
		result,
		sourcePath: 'src/example.ts',
		sourceHash: hashText('export const greet = "hello";'),
		languageId: 'typescript',
		model: 'runtime-default',
		interpretedAt: '2026-08-22T00:00:00.000Z',
	});
}

suite('English document', () => {
	test('parses rendered Markdown and derives every stable state', () => {
		const parsed = parseEnglishDocument(rendered());
		const { sourceHash, editableEnglishHash } = parsed.frontmatter;

		assert.strictEqual(
			deriveSyncState(sourceHash, sourceHash, parsed.currentEnglishHashes, editableEnglishHash),
			'SYNCED',
		);
		assert.strictEqual(
			deriveSyncState(hashText('changed'), sourceHash, parsed.currentEnglishHashes, editableEnglishHash),
			'CODE_CHANGED',
		);

		const edited = parseEnglishDocument(rendered().replace('Return a greeting.', 'Return two greetings.'));
		assert.strictEqual(
			deriveSyncState(sourceHash, sourceHash, edited.currentEnglishHashes, editableEnglishHash),
			'ENGLISH_CHANGED',
		);
		assert.strictEqual(
			deriveSyncState(hashText('changed'), sourceHash, edited.currentEnglishHashes, editableEnglishHash),
			'BOTH_CHANGED',
		);
	});

	test('excludes generated relationship content from the English hash', () => {
		const original = parseEnglishDocument(rendered());
		const changedGeneratedSection = parseEnglishDocument(
			rendered().replace('## Dependencies', '## Dependencies\n\n- ./dependency.ts'),
		);

		assert.strictEqual(
			changedGeneratedSection.currentEnglishHashes[0],
			original.currentEnglishHashes[0],
		);
	});

	test('recognizes the Phase 1 legacy baseline hash', () => {
		const legacyResult = {
			...result,
			behavior: [{
				statement: 'Return the greeting.',
				evidence: { startLine: 1, endLine: 1, symbolName: 'greet' },
			}],
		};
		const legacyHash = hashText(JSON.stringify(legacyResult));
		const legacyMarkdown = rendered()
			.replace('_(1–1)_', '_(1–1; symbol `greet`)_')
			.replace(
			/editableEnglishHash: "sha256:[a-f0-9]{64}"/u,
			`editableEnglishHash: "${legacyHash}"`,
			);
		const parsed = parseEnglishDocument(legacyMarkdown);

		assert.ok(parsed.currentEnglishHashes.includes(legacyHash));
		assert.strictEqual(
			deriveSyncState(
				parsed.frontmatter.sourceHash,
				parsed.frontmatter.sourceHash,
				parsed.currentEnglishHashes,
				legacyHash,
			),
			'SYNCED',
		);
	});

	test('recovers a synchronized persisted interpretation after reopen', () => {
		const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-reopen-test-'));
		const englishPath = path.join(temporaryRoot, 'example.ts.md');
		try {
			writeFileSync(englishPath, rendered(), 'utf8');
			const reopened = parseEnglishDocument(readFileSync(englishPath, 'utf8'));
			assert.strictEqual(
				deriveSyncState(
					reopened.frontmatter.sourceHash,
					reopened.frontmatter.sourceHash,
					reopened.currentEnglishHashes,
					reopened.frontmatter.editableEnglishHash,
				),
				'SYNCED',
			);
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

	test('rejects malformed documents without changing their text', () => {
		const malformed = rendered().replace('## Purpose', '## Intent');
		assert.throws(() => parseEnglishDocument(malformed), /required heading: ## Purpose/u);
	});

	test('routes both-changed state through a neutral direction chooser', () => {
		assert.strictEqual(syncCommandForState('CODE_CHANGED'), 'langclarity.codeToEnglish');
		assert.strictEqual(syncCommandForState('ENGLISH_CHANGED'), 'langclarity.englishToCode');
		assert.strictEqual(syncCommandForState('BOTH_CHANGED'), 'langclarity.chooseSyncDirection');
		assert.strictEqual(syncCommandForState('SYNCED'), undefined);
	});

	test('accepts a complete proposal refresh only for the proposed source pair', () => {
		const markdown = rendered();
		const parsed = parseEnglishDocument(markdown);
		const expected = {
			sourceHash: parsed.frontmatter.sourceHash,
			source: parsed.frontmatter.source,
			languageId: parsed.frontmatter.languageId,
		};

		assert.doesNotThrow(() => validateProposalRefresh(markdown, expected));
		assert.throws(
			() => validateProposalRefresh(markdown, { ...expected, sourceHash: hashText('different source') }),
			/does not match the proposed source/u,
		);
		assert.throws(
			() => validateProposalRefresh(markdown, { ...expected, source: 'src/other.ts' }),
			/does not match the proposed source/u,
		);
	});
});
