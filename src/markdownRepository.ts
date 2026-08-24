import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
	await assertSafeEnglishPath(uri, true);
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return false;
		}
		throw error;
	}
}

export async function writeNewFileAtomically(uri: vscode.Uri, content: string): Promise<void> {
	if (await uriExists(uri)) {
		throw new Error('An English interpretation already exists. Open it instead of replacing it.');
	}

	await writeAtomically(uri, content, false);
}

export async function replaceFileAtomically(uri: vscode.Uri, content: string): Promise<void> {
	await writeAtomically(uri, content, true);
}

export async function readTextFile(uri: vscode.Uri): Promise<string> {
	await assertSafeEnglishPath(uri, true);
	return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
}

export async function replaceTextDocumentAndSave(
	document: vscode.TextDocument,
	expectedText: string,
	content: string,
): Promise<void> {
	if (document.getText() !== expectedText) {
		throw new Error('The English document changed before the refresh could be applied.');
	}
	const edit = new vscode.WorkspaceEdit();
	edit.replace(
		document.uri,
		new vscode.Range(new vscode.Position(0, 0), document.positionAt(expectedText.length)),
		content,
	);
	if (!await vscode.workspace.applyEdit(edit)) {
		throw new Error('VS Code rejected the refreshed English document.');
	}
	if (document.getText() !== content) {
		throw new Error('The English document changed while the refresh was being applied.');
	}
	if (await document.save()) {
		return;
	}
	if (document.getText() !== content) {
		throw new Error('VS Code could not save the refreshed English document, and it changed before rollback. The current buffer was preserved.');
	}

	const rollback = new vscode.WorkspaceEdit();
	rollback.replace(
		document.uri,
		new vscode.Range(new vscode.Position(0, 0), document.positionAt(content.length)),
		expectedText,
	);
	await vscode.workspace.applyEdit(rollback);
	throw new Error('VS Code could not save the refreshed English document. The previous English was restored.');
}

async function writeAtomically(uri: vscode.Uri, content: string, overwrite: boolean): Promise<void> {
	await assertSafeEnglishPath(uri, true);
	const parent = vscode.Uri.joinPath(uri, '..');
	await vscode.workspace.fs.createDirectory(parent);
	await assertSafeEnglishPath(uri, true);
	const temporary = uri.with({ path: `${uri.path}.${randomUUID()}.tmp` });
	try {
		await vscode.workspace.fs.writeFile(temporary, Buffer.from(content, 'utf8'));
		await vscode.workspace.fs.rename(temporary, uri, { overwrite });
	} catch (error) {
		try {
			await vscode.workspace.fs.delete(temporary);
		} catch {
			// The temporary file may not have been created or may already have been moved.
		}
		throw error;
	}
}

async function assertSafeEnglishPath(uri: vscode.Uri, includeTarget: boolean): Promise<void> {
	const workspace = vscode.workspace.getWorkspaceFolder(uri);
	if (!workspace) {
		return;
	}
	await assertPathHasNoSymlinks(workspace.uri, uri, includeTarget);
}

export async function assertPathHasNoSymlinks(
	workspaceUri: vscode.Uri,
	uri: vscode.Uri,
	includeTarget = true,
): Promise<void> {
	if (uri.scheme !== 'file' || workspaceUri.scheme !== 'file') {
		return;
	}
	const relative = path.relative(workspaceUri.fsPath, uri.fsPath);
	if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error('The English document path must remain inside its workspace.');
	}

	const workspaceRealPath = await realpath(workspaceUri.fsPath);
	const components = relative.split(path.sep);
	const inspectedComponents = includeTarget ? components : components.slice(0, -1);
	let currentPath = workspaceUri.fsPath;
	for (const component of inspectedComponents) {
		currentPath = path.join(currentPath, component);
		let stats;
		try {
			stats = await lstat(currentPath);
		} catch (error) {
			if (isMissingPathError(error)) {
				return;
			}
			throw error;
		}
		if (stats.isSymbolicLink()) {
			throw new Error('LangClarity will not follow symbolic links in its English document path.');
		}
		const resolved = await realpath(currentPath);
		const resolvedRelative = path.relative(workspaceRealPath, resolved);
		if (resolvedRelative === '..'
			|| resolvedRelative.startsWith(`..${path.sep}`)
			|| path.isAbsolute(resolvedRelative)) {
			throw new Error('The English document path resolves outside its workspace.');
		}
	}
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
