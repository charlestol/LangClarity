import * as assert from 'node:assert';
import { appendLangClarityIgnoreRule, hasLangClarityIgnoreRule } from '../gitignore';

suite('Git ignore handling', () => {
	test('recognizes common rules that already ignore the workspace folder', () => {
		for (const rule of ['.langclarity', '.langclarity/', '/.langclarity/', '**/.langclarity/']) {
			assert.strictEqual(hasLangClarityIgnoreRule(`${rule}\n`), true, rule);
		}
		assert.strictEqual(hasLangClarityIgnoreRule('!.langclarity/\n'), false);
		assert.strictEqual(hasLangClarityIgnoreRule('.langclarity/\n!.langclarity/\n'), false);
		assert.strictEqual(hasLangClarityIgnoreRule('!.langclarity/\n/.langclarity/\n'), true);
	});

	test('appends one root-relative rule while preserving newline style', () => {
		assert.strictEqual(appendLangClarityIgnoreRule('node_modules/'), 'node_modules/\n/.langclarity/\n');
		assert.strictEqual(
			appendLangClarityIgnoreRule('node_modules/\r\n', '\r\n'),
			'node_modules/\r\n/.langclarity/\r\n',
		);
		assert.strictEqual(appendLangClarityIgnoreRule('.langclarity/\n'), '.langclarity/\n');
	});
});
