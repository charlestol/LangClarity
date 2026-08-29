import * as assert from 'node:assert';
import { sourceLimitError } from '../interpretation';

suite('Source limits', () => {
	test('reports the measured byte limit violation', () => {
		assert.strictEqual(
			sourceLimitError('x'.repeat(75 * 1024 + 1)),
			'LangClarity cannot interpret this file because it exceeds the source limit: 76,801 bytes (maximum 76,800 bytes / 75 KiB). Reduce or split the file, then try again.',
		);
	});

	test('reports every violated source limit', () => {
		const source = `${'x'.repeat(75 * 1024)}\n${'\n'.repeat(2_000)}`;
		assert.strictEqual(
			sourceLimitError(source),
			'LangClarity cannot interpret this file because it exceeds the source limit: 78,801 bytes (maximum 76,800 bytes / 75 KiB) and 2,002 lines (maximum 2,000). Reduce or split the file, then try again.',
		);
	});
});
