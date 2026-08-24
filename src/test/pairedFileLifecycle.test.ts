import * as assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import { parseEnglishDocument } from '../englishDocument';
import { hashText, renderInterpretation } from '../interpretation';
import {
	movePairedDirectory,
	movePairedEnglish,
	orphanEnglish,
	orphanPairedDirectory,
} from '../pairedFileLifecycle';

suite('Paired file lifecycle', () => {
	test('moves English and updates generated source metadata without changing its baseline', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-lifecycle-'));
		const workspace = vscode.Uri.file(root);
		const oldEnglishPath = path.join(root, '.langclarity', 'src', 'old.ts.md');
		const newEnglishPath = path.join(root, '.langclarity', 'lib', 'new.ts.md');
		const markdown = fixtureMarkdown('src/old.ts');
		mkdirSync(path.dirname(oldEnglishPath), { recursive: true });
		writeFileSync(oldEnglishPath, markdown, { encoding: 'utf8', flag: 'wx' });
		const oldBaseline = parseEnglishDocument(markdown).frontmatter.editableEnglishHash;

		try {
			await movePairedEnglish(
				workspace,
				vscode.Uri.file(path.join(root, 'lib', 'new.ts')),
				vscode.Uri.file(oldEnglishPath),
				vscode.Uri.file(newEnglishPath),
			);
			const moved = parseEnglishDocument(readFileSync(newEnglishPath, 'utf8'));
			assert.strictEqual(moved.frontmatter.source, 'lib/new.ts');
			assert.strictEqual(moved.frontmatter.editableEnglishHash, oldBaseline);
			assert.ok(moved.currentEnglishHashes.includes(oldBaseline));
			assert.match(moved.body, /^# `lib\/new\.ts`$/mu);
			assert.throws(() => readFileSync(oldEnglishPath), /ENOENT/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('moves deleted-source English into the orphaned tree', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-orphan-'));
		const source = vscode.Uri.file(path.join(root, 'src', 'old.ts'));
		const englishPath = path.join(root, '.langclarity', 'src', 'old.ts.md');
		mkdirSync(path.dirname(englishPath), { recursive: true });
		writeFileSync(englishPath, fixtureMarkdown('src/old.ts'), { encoding: 'utf8', flag: 'wx' });

		try {
			const orphan = await orphanEnglish(vscode.Uri.file(root), source, vscode.Uri.file(englishPath));
			assert.match(orphan.path, /\/\.langclarity\/\.orphaned\/[^/]+\/src\/old\.ts\.md$/u);
			assert.ok(readFileSync(orphan.fsPath, 'utf8').includes('Return a greeting.'));
			assert.throws(() => readFileSync(englishPath), /ENOENT/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('supports case-only paired file renames', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-case-'));
		const oldEnglishPath = path.join(root, '.langclarity', 'src', 'thing.ts.md');
		const newEnglishPath = path.join(root, '.langclarity', 'src', 'Thing.ts.md');
		mkdirSync(path.dirname(oldEnglishPath), { recursive: true });
		writeFileSync(oldEnglishPath, fixtureMarkdown('src/thing.ts'), { encoding: 'utf8', flag: 'wx' });

		try {
			await movePairedEnglish(
				vscode.Uri.file(root),
				vscode.Uri.file(path.join(root, 'src', 'Thing.ts')),
				vscode.Uri.file(oldEnglishPath),
				vscode.Uri.file(newEnglishPath),
			);
			const moved = parseEnglishDocument(readFileSync(newEnglishPath, 'utf8'));
			assert.strictEqual(moved.frontmatter.source, 'src/Thing.ts');
			assert.match(moved.body, /^# `src\/Thing\.ts`$/mu);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('validates paired English before moving the original', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-atomic-'));
		const oldEnglishPath = path.join(root, '.langclarity', 'src', 'old.ts.md');
		const newEnglishPath = path.join(root, '.langclarity', 'lib', 'new.ts.md');
		mkdirSync(path.dirname(oldEnglishPath), { recursive: true });
		writeFileSync(oldEnglishPath, 'not a LangClarity document', { encoding: 'utf8', flag: 'wx' });

		try {
			await assert.rejects(movePairedEnglish(
				vscode.Uri.file(root),
				vscode.Uri.file(path.join(root, 'lib', 'new.ts')),
				vscode.Uri.file(oldEnglishPath),
				vscode.Uri.file(newEnglishPath),
			), /frontmatter/u);
			assert.strictEqual(readFileSync(oldEnglishPath, 'utf8'), 'not a LangClarity document');
			assert.throws(() => readFileSync(newEnglishPath), /ENOENT/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('preserves an unsaved English buffer while moving its pair', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-dirty-move-'));
		const oldEnglishPath = path.join(root, '.langclarity', 'src', 'old.ts.md');
		const newEnglishPath = path.join(root, '.langclarity', 'lib', 'new.ts.md');
		mkdirSync(path.dirname(oldEnglishPath), { recursive: true });
		writeFileSync(oldEnglishPath, fixtureMarkdown('src/old.ts'), { encoding: 'utf8', flag: 'wx' });
		const oldUri = vscode.Uri.file(oldEnglishPath);
		const newUri = vscode.Uri.file(newEnglishPath);
		const document = await vscode.workspace.openTextDocument(oldUri);
		let movedDocument: vscode.TextDocument | undefined;
		const edit = new vscode.WorkspaceEdit();
		const greetingOffset = document.getText().indexOf('Return a greeting.');
		assert.ok(greetingOffset >= 0);
		edit.replace(
			oldUri,
			new vscode.Range(document.positionAt(greetingOffset), document.positionAt(greetingOffset + 18)),
			'Return an edited greeting.',
		);
		assert.ok(await vscode.workspace.applyEdit(edit));
		assert.strictEqual(document.isDirty, true);

		try {
			await movePairedEnglish(
				vscode.Uri.file(root),
				vscode.Uri.file(path.join(root, 'lib', 'new.ts')),
				oldUri,
				newUri,
			);
			movedDocument = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === newUri.toString());
			assert.ok(movedDocument);
			assert.strictEqual(movedDocument.isDirty, true);
			assert.ok(movedDocument.getText().includes('Return an edited greeting.'));
			assert.strictEqual(parseEnglishDocument(movedDocument.getText()).frontmatter.source, 'lib/new.ts');
			await movedDocument.save();
		} finally {
			if (movedDocument) {
				await vscode.window.showTextDocument(movedDocument);
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
			}
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('moves paired documents beneath a renamed directory', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-directory-move-'));
		const oldSourceDirectory = path.join(root, 'old');
		const newSourceDirectory = path.join(root, 'renamed');
		const oldEnglishPath = path.join(root, '.langclarity', 'old', 'nested', 'item.ts.md');
		const newEnglishPath = path.join(root, '.langclarity', 'renamed', 'nested', 'item.ts.md');
		mkdirSync(path.join(oldSourceDirectory, 'nested'), { recursive: true });
		writeFileSync(path.join(oldSourceDirectory, 'nested', 'item.ts'), 'export {};', 'utf8');
		mkdirSync(path.dirname(oldEnglishPath), { recursive: true });
		writeFileSync(
			oldEnglishPath,
			fixtureMarkdown('old/nested/item.ts'),
			{ encoding: 'utf8', flag: 'wx' },
		);
		renameSync(oldSourceDirectory, newSourceDirectory);

		try {
			await movePairedDirectory(
				vscode.Uri.file(root),
				vscode.Uri.file(oldSourceDirectory),
				vscode.Uri.file(newSourceDirectory),
			);
			const moved = parseEnglishDocument(readFileSync(newEnglishPath, 'utf8'));
			assert.strictEqual(moved.frontmatter.source, 'renamed/nested/item.ts');
			assert.throws(() => readFileSync(oldEnglishPath), /ENOENT/u);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('orphans paired documents beneath a deleted directory', async () => {
		const root = mkdtempSync(path.join(tmpdir(), 'langclarity-directory-delete-'));
		const sourceDirectory = path.join(root, 'src');
		const englishPath = path.join(root, '.langclarity', 'src', 'nested', 'item.ts.md');
		mkdirSync(path.dirname(englishPath), { recursive: true });
		writeFileSync(englishPath, fixtureMarkdown('src/nested/item.ts'), { encoding: 'utf8', flag: 'wx' });

		try {
			await orphanPairedDirectory(vscode.Uri.file(root), vscode.Uri.file(sourceDirectory));
			assert.throws(() => readFileSync(englishPath), /ENOENT/u);
			const orphanRoot = path.join(root, '.langclarity', '.orphaned');
			const orphanIds = (await vscode.workspace.fs.readDirectory(vscode.Uri.file(orphanRoot)))
				.map(([name]) => name);
			assert.strictEqual(orphanIds.length, 1);
			assert.ok(readFileSync(
				path.join(orphanRoot, orphanIds[0], 'src', 'nested', 'item.ts.md'),
				'utf8',
			).includes('Return a greeting.'));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

function fixtureMarkdown(sourcePath: string): string {
	return renderInterpretation({
		result: {
			purpose: 'Return a greeting.',
			responsibilities: ['Create a greeting.'],
			behavior: [{
				statement: 'Return the greeting.',
				evidence: { startLine: 1, endLine: 1, symbolName: 'greet' },
			}],
			sideEffects: [],
			constraints: [],
		},
		sourcePath,
		sourceHash: hashText('export const greet = "hello";'),
		languageId: 'typescript',
		model: 'runtime-default',
		interpretedAt: '2026-08-22T00:00:00.000Z',
	});
}
