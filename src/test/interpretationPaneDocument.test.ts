import * as assert from 'node:assert';
import {
	behaviorRowsForSource,
	interpretationPaneContent,
	replacePaneBehavior,
} from '../interpretationPaneDocument';
import { hashText, renderInterpretation, type InterpretationResult } from '../interpretation';

const result: InterpretationResult = {
	purpose: 'Return a greeting.',
	responsibilities: ['Create a greeting.'],
	behavior: [{
		statement: 'Return the greeting.',
		sourceLine: 1,
	}],
	sideEffects: ['Writes to standard output.'],
	constraints: ['The name must be present.'],
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

suite('Interpretation pane document', () => {
	test('presents editable behavior and grouped read-only sections', () => {
		const content = interpretationPaneContent(rendered());

		assert.strictEqual(content.source, 'src/example.ts');
		assert.strictEqual(content.behavior[0].statement, 'Return the greeting.');
		assert.strictEqual(content.behavior[0].evidence, 'Lines 1–1');
		assert.strictEqual(content.behavior[0].startLine, 1);
		assert.strictEqual(content.behavior[0].endLine, 1);
		assert.strictEqual(content.behavior[0].definitionName, undefined);
		assert.strictEqual(content.overview[0].content, 'Return a greeting.');
		assert.strictEqual(content.structure[0].heading, 'Key definitions');
		assert.strictEqual(content.effects[1].content, '- The name must be present.');
	});

	test('presents the legacy section as Key definitions', () => {
		const legacy = rendered().replace('## Key definitions', '## Symbols');
		const content = interpretationPaneContent(legacy);

		assert.strictEqual(content.structure[0].heading, 'Key definitions');
		assert.strictEqual(content.structure[0].content, '_None verified._');
	});

	test('preserves exact source-line order including a blank row', () => {
		const markdown = renderInterpretation({
			result: {
				...result,
				behavior: [
					{ statement: 'Create the greeting.', sourceLine: 1 },
					{ statement: '', sourceLine: 2 },
					{ statement: 'Give back the greeting.', sourceLine: 3 },
				],
			},
			sourcePath: 'src/example.ts',
			sourceHash: hashText('create\n\nreturn'),
			languageId: 'typescript',
			model: 'runtime-default',
			interpretedAt: '2026-08-22T00:00:00.000Z',
		});

		assert.deepStrictEqual(
			interpretationPaneContent(markdown).behavior.map((item) => [item.statement, item.startLine]),
			[
				['Create the greeting.', 1],
				['', 2],
				['Give back the greeting.', 3],
			],
		);
	});

	test('persists every source-aligned row instead of dropping blank rows', () => {
		const markdown = renderInterpretation({
			result: {
				...result,
				behavior: [
					{ statement: 'Create the messages.', sourceLine: 1 },
					{ statement: '', sourceLine: 2 },
					{ statement: 'Give back one message.', sourceLine: 3 },
				],
			},
			sourcePath: 'src/example.ts',
			sourceHash: hashText('create\n\nreturn'),
			languageId: 'typescript',
			model: 'runtime-default',
			interpretedAt: '2026-08-22T00:00:00.000Z',
		});
		const content = interpretationPaneContent(markdown);
		const rows = behaviorRowsForSource(content.behavior, 3);

		assert.strictEqual(rows.length, 3);
		assert.strictEqual(rows[1].statement, '');
		assert.strictEqual(rows[1].evidenceSuffix, '_(2–2)_');

		const updated = replacePaneBehavior(markdown, rows);
		assert.ok(updated.includes('2.  _(2–2)_'));
		assert.strictEqual(interpretationPaneContent(updated).behavior.length, 3);
	});

	test('changes only Behavior and preserves source evidence', () => {
		const original = rendered();
		const content = interpretationPaneContent(original);
		const updated = replacePaneBehavior(original, [{
			...content.behavior[0],
			statement: 'Return a personalized greeting.',
		}]);

		assert.ok(updated.includes('1. Return a personalized greeting. _(1–1)_'));
		assert.strictEqual(
			updated.replace('Return a personalized greeting.', 'Return the greeting.'),
			original,
		);
	});

	test('preserves structured-English indentation through the Markdown document', () => {
		const content = interpretationPaneContent(rendered());
		const updated = replacePaneBehavior(rendered(), [{
			...content.behavior[0],
			statement: '  Return the greeting.',
		}]);

		assert.strictEqual(interpretationPaneContent(updated).behavior[0].statement, '  Return the greeting.');
	});

	test('document round-tripping supports behavior without generated evidence', () => {
		const withoutBehavior = replacePaneBehavior(rendered(), []);
		assert.ok(withoutBehavior.includes('## Behavior\n\n_None identified._'));

		const added = replacePaneBehavior(withoutBehavior, [{ statement: 'Greet the current user.' }]);
		assert.ok(added.includes('## Behavior\n\n1. Greet the current user.'));
		assert.strictEqual(interpretationPaneContent(added).behavior[0].evidence, undefined);
	});

	test('keeps each behavior item on one logical English line', () => {
		const content = interpretationPaneContent(rendered());
		const updated = replacePaneBehavior(rendered(), [{
			...content.behavior[0],
			statement: 'Return a greeting.\nUse the supplied name.',
		}]);

		assert.ok(updated.includes('1. Return a greeting. Use the supplied name. _(1–1)_'));
		assert.strictEqual(
			interpretationPaneContent(updated).behavior[0].statement,
			'Return a greeting. Use the supplied name.',
		);
	});

	test('preserves CRLF outside the edited section', () => {
		const original = rendered().replaceAll('\n', '\r\n');
		const content = interpretationPaneContent(original);
		const updated = replacePaneBehavior(original, [{ ...content.behavior[0], statement: 'Return hello.' }]);

		assert.ok(updated.includes('## Purpose\r\n\r\nReturn a greeting.'));
		assert.ok(!/(?<!\r)\n/u.test(updated));
	});
});
