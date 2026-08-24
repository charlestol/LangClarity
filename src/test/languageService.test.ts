import * as assert from 'node:assert';
import {
	minimalReplacement,
	preserveSourceStyle,
	syntaxIssues,
} from '../languageService';

suite('Language service', () => {
	test('loads TypeScript on demand and reports TypeScript and JSX syntax issues', async () => {
		const typescriptPath = require.resolve('typescript');
		assert.strictEqual(require.cache[typescriptPath], undefined);
		assert.ok((await syntaxIssues('export function broken( {', 'broken.ts')).length > 0);
		assert.ok(require.cache[typescriptPath]);
		assert.ok((await syntaxIssues('export const view = <div>;', 'broken.tsx')).length > 0);
		assert.deepStrictEqual(await syntaxIssues('export const valid = 1;', 'valid.ts'), []);
	});

	test('preserves EOL and final-newline style', () => {
		assert.strictEqual(
			preserveSourceStyle('const a = 1;\r\n', 'const a = 2;\n'),
			'const a = 2;\r\n',
		);
		assert.strictEqual(
			preserveSourceStyle('const a = 1;', 'const a = 2;\n'),
			'const a = 2;',
		);
		assert.strictEqual(
			preserveSourceStyle('\uFEFFconst a = 1;\n', 'const a = 2;\n\n'),
			'\uFEFFconst a = 2;\n',
		);
	});

	test('creates one focused replacement without splitting Unicode pairs', () => {
		assert.deepStrictEqual(minimalReplacement('hello world', 'hello there'), {
			startOffset: 6,
			endOffset: 11,
			newText: 'there',
		});
		const unicode = minimalReplacement('const icon = "😀";', 'const icon = "🚀";');
		assert.ok(unicode);
		assert.strictEqual(
			'const icon = "😀";'.slice(0, unicode.startOffset)
				+ unicode.newText
				+ 'const icon = "😀";'.slice(unicode.endOffset),
			'const icon = "🚀";',
		);
		assert.strictEqual(minimalReplacement('same', 'same'), undefined);
	});
});
