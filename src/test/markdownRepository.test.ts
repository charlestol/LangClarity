import * as assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {
	assertPathHasNoSymlinks,
	replaceTextDocumentAndSave,
	writeNewFileAtomically,
} from '../markdownRepository';

suite('Markdown repository', () => {
	test('creates parent directories and never replaces existing English', async () => {
		const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-test-'));
		const targetPath = path.join(temporaryRoot, '.langclarity', 'src', 'example.ts.md');
		const target = vscode.Uri.file(targetPath);

		try {
			await writeNewFileAtomically(target, 'first');
			await assert.rejects(
				writeNewFileAtomically(target, 'second'),
				/already exists/u,
			);
			assert.strictEqual(readFileSync(targetPath, 'utf8'), 'first');
		} finally {
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

	test('replaces and saves only the expected English document', async () => {
		const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-refresh-test-'));
		const targetPath = path.join(temporaryRoot, 'example.ts.md');
		const target = vscode.Uri.file(targetPath);

		try {
			await writeNewFileAtomically(target, 'previous English');
			const document = await vscode.workspace.openTextDocument(target);
			await vscode.window.showTextDocument(document, { preview: false });
			await replaceTextDocumentAndSave(document, 'previous English', 'refreshed English');
			assert.strictEqual(document.getText(), 'refreshed English');
			assert.strictEqual(readFileSync(targetPath, 'utf8'), 'refreshed English');
			await assert.rejects(
				replaceTextDocumentAndSave(document, 'stale English', 'unexpected English'),
				/changed before the refresh/u,
			);
			assert.strictEqual(readFileSync(targetPath, 'utf8'), 'refreshed English');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await new Promise((resolve) => setTimeout(resolve, 250));
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

	test('preserves concurrent edits when saving refreshed English fails', async () => {
		const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-rollback-test-'));
		const targetPath = path.join(temporaryRoot, 'example.ts.md');
		const target = vscode.Uri.file(targetPath);

		try {
			await writeNewFileAtomically(target, 'previous English');
			const document = await vscode.workspace.openTextDocument(target);
			const failingSaveDocument = {
				uri: document.uri,
				getText: document.getText.bind(document),
				positionAt: document.positionAt.bind(document),
				save: async (): Promise<boolean> => {
					const concurrentEdit = new vscode.WorkspaceEdit();
					concurrentEdit.replace(
						document.uri,
						new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)),
						'concurrent user edit',
					);
					assert.strictEqual(await vscode.workspace.applyEdit(concurrentEdit), true);
					return false;
				},
			} as unknown as vscode.TextDocument;

			await assert.rejects(
				replaceTextDocumentAndSave(failingSaveDocument, 'previous English', 'refreshed English'),
				/changed before rollback/u,
			);
			assert.strictEqual(document.getText(), 'concurrent user edit');
		} finally {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await new Promise((resolve) => setTimeout(resolve, 250));
			rmSync(temporaryRoot, { recursive: true, force: true });
		}
	});

	test('rejects symbolic links in workspace English paths', async () => {
		const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-symlink-workspace-'));
		const externalRoot = mkdtempSync(path.join(tmpdir(), 'langclarity-symlink-target-'));
		const linkedDirectory = path.join(workspaceRoot, 'linked');
		symlinkSync(externalRoot, linkedDirectory, 'dir');

		try {
			await assert.rejects(
				assertPathHasNoSymlinks(
					vscode.Uri.file(workspaceRoot),
					vscode.Uri.file(path.join(linkedDirectory, 'example.ts.md')),
				),
				/symbolic links/u,
			);
			assert.throws(() => readFileSync(path.join(externalRoot, 'example.ts.md')), /ENOENT/u);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
			rmSync(externalRoot, { recursive: true, force: true });
		}
	});
});
