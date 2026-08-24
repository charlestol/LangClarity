import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import { parseEnglishDocument, renderFrontmatter } from './englishDocument';
import { englishUriFor, relativeSourcePath } from './interpretation';
import {
	assertPathHasNoSymlinks,
	uriExists,
} from './markdownRepository';
import { SessionCoordinator } from './sessionCoordinator';

const supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

export class PairedFileLifecycle implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[];

	constructor(
		private readonly sessions: SessionCoordinator,
		private readonly output: vscode.OutputChannel,
	) {
		this.disposables = [
			vscode.workspace.onDidRenameFiles((event) => {
				void this.handleRenames(event.files);
			}),
			vscode.workspace.onDidDeleteFiles((event) => {
				void this.handleDeletes(event.files);
			}),
		];
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	private async handleRenames(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
		for (const { oldUri, newUri } of files) {
			const oldWorkspace = vscode.workspace.getWorkspaceFolder(oldUri);
			if (!oldWorkspace) {
				continue;
			}

			try {
				if (!isSupportedSource(oldUri)) {
					const moved = await movePairedDirectory(oldWorkspace.uri, oldUri, newUri);
					for (const entry of moved) {
						this.sessions.forget(entry.oldSourceUri);
						if (entry.newSourceUri && entry.newEnglishUri) {
							await this.sessions.load(entry.newSourceUri, entry.newEnglishUri);
						}
					}
					continue;
				}
				const oldEnglish = englishUriFor(oldWorkspace.uri, oldUri);
				if (!await uriExists(oldEnglish)) {
					continue;
				}
				const newWorkspace = vscode.workspace.getWorkspaceFolder(newUri);
				if (!newWorkspace || !isSupportedSource(newUri)) {
					await orphanEnglish(oldWorkspace.uri, oldUri, oldEnglish);
					this.sessions.forget(oldUri);
					continue;
				}
				const newEnglish = englishUriFor(newWorkspace.uri, newUri);
				await movePairedEnglish(
					newWorkspace.uri,
					newUri,
					oldEnglish,
					newEnglish,
				);
				this.sessions.forget(oldUri);
				await this.sessions.load(newUri, newEnglish);
				this.output.appendLine(`lifecycle:moved file=${path.posix.basename(newUri.path)}`);
			} catch (error) {
				await this.showLifecycleError('move', newUri, error);
			}
		}
	}

	private async handleDeletes(files: readonly vscode.Uri[]): Promise<void> {
		for (const sourceUri of files) {
			const workspace = vscode.workspace.getWorkspaceFolder(sourceUri);
			if (!workspace) {
				continue;
			}
			try {
				if (!isSupportedSource(sourceUri)) {
					const orphaned = await orphanPairedDirectory(workspace.uri, sourceUri);
					for (const orphanedSource of orphaned) {
						this.sessions.forget(orphanedSource);
					}
					continue;
				}
				const englishUri = englishUriFor(workspace.uri, sourceUri);
				if (!await uriExists(englishUri)) {
					this.sessions.forget(sourceUri);
					continue;
				}
				await orphanEnglish(workspace.uri, sourceUri, englishUri);
				this.sessions.forget(sourceUri);
				this.output.appendLine(`lifecycle:orphaned file=${path.posix.basename(sourceUri.path)}`);
			} catch (error) {
				await this.showLifecycleError('preserve deleted-source English for', sourceUri, error);
			}
		}
	}

	private async showLifecycleError(action: string, uri: vscode.Uri, error: unknown): Promise<void> {
		const message = error instanceof Error ? error.message : 'unknown workspace error';
		this.output.appendLine(`lifecycle:failed action=${action} file=${path.posix.basename(uri.path)}`);
		await vscode.window.showErrorMessage(`LangClarity could not ${action} paired English: ${message}.`);
	}
}

export async function movePairedEnglish(
	newWorkspaceUri: vscode.Uri,
	newSourceUri: vscode.Uri,
	oldEnglishUri: vscode.Uri,
	newEnglishUri: vscode.Uri,
): Promise<void> {
	const oldWorkspaceUri = workspaceUriForEnglish(oldEnglishUri);
	await assertPathHasNoSymlinks(oldWorkspaceUri, oldEnglishUri);
	await assertPathHasNoSymlinks(newWorkspaceUri, newEnglishUri);
	if (!samePathIgnoringCase(oldEnglishUri, newEnglishUri) && await uriExists(newEnglishUri)) {
		throw new Error('the destination already has an English interpretation');
	}
	const openDocument = findOpenDocument(oldEnglishUri);
	const original = openDocument
		? openDocument.getText()
		: Buffer.from(await vscode.workspace.fs.readFile(oldEnglishUri)).toString('utf8');
	const parsed = parseEnglishDocument(original);
	const source = relativeSourcePath(newWorkspaceUri, newSourceUri);
	const updatedBody = parsed.body.replace(/^# .+$/mu, `# \`${escapeCodeSpan(source)}\``);
	const updated = renderFrontmatter({
		...parsed.frontmatter,
		source,
		languageId: languageIdFor(newSourceUri),
	}, updatedBody);

	if (openDocument) {
		await moveOpenEnglishDocument(openDocument, newEnglishUri, original, updated);
		return;
	}
	await moveClosedEnglishFile(oldEnglishUri, newEnglishUri, updated);
}

export async function movePairedDirectory(
	oldWorkspaceUri: vscode.Uri,
	oldDirectoryUri: vscode.Uri,
	newDirectoryUri: vscode.Uri,
): Promise<Array<{
	oldSourceUri: vscode.Uri;
	newSourceUri?: vscode.Uri;
	newEnglishUri?: vscode.Uri;
}>> {
	const entries = await pairedEntriesUnder(oldWorkspaceUri, oldDirectoryUri);
	const moved: Array<{
		oldSourceUri: vscode.Uri;
		newSourceUri?: vscode.Uri;
		newEnglishUri?: vscode.Uri;
	}> = [];
	for (const entry of entries) {
		const newSourceUri = vscode.Uri.joinPath(newDirectoryUri, entry.childSourcePath);
		const newWorkspaceUri = vscode.workspace.getWorkspaceFolder(newSourceUri)?.uri
			?? workspaceRootContaining(oldWorkspaceUri, newSourceUri);
		if (!newWorkspaceUri || !isSupportedSource(newSourceUri)) {
			await orphanEnglish(oldWorkspaceUri, entry.sourceUri, entry.englishUri);
			moved.push({ oldSourceUri: entry.sourceUri });
			continue;
		}
		const newEnglishUri = englishUriFor(newWorkspaceUri, newSourceUri);
		await movePairedEnglish(
			newWorkspaceUri,
			newSourceUri,
			entry.englishUri,
			newEnglishUri,
		);
		moved.push({ oldSourceUri: entry.sourceUri, newSourceUri, newEnglishUri });
	}
	return moved;
}

export async function orphanPairedDirectory(
	workspaceUri: vscode.Uri,
	sourceDirectoryUri: vscode.Uri,
): Promise<vscode.Uri[]> {
	const entries = await pairedEntriesUnder(workspaceUri, sourceDirectoryUri);
	for (const entry of entries) {
		await orphanEnglish(workspaceUri, entry.sourceUri, entry.englishUri);
	}
	return entries.map((entry) => entry.sourceUri);
}

export async function orphanEnglish(
	workspaceUri: vscode.Uri,
	sourceUri: vscode.Uri,
	englishUri: vscode.Uri,
): Promise<vscode.Uri> {
	await assertPathHasNoSymlinks(workspaceUri, englishUri);
	const relative = relativeSourcePath(workspaceUri, sourceUri);
	const orphanUri = vscode.Uri.joinPath(
		workspaceUri,
		'.langclarity',
		'.orphaned',
		randomUUID(),
		`${relative}.md`,
	);
	await assertPathHasNoSymlinks(workspaceUri, orphanUri);
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(orphanUri, '..'));
	await assertPathHasNoSymlinks(workspaceUri, orphanUri);
	const openDocument = findOpenDocument(englishUri);
	if (openDocument) {
		await renameOpenDocument(openDocument, orphanUri);
	} else {
		await vscode.workspace.fs.rename(englishUri, orphanUri, { overwrite: false });
	}
	return orphanUri;
}

interface PairedDirectoryEntry {
	childSourcePath: string;
	sourceUri: vscode.Uri;
	englishUri: vscode.Uri;
}

async function pairedEntriesUnder(
	workspaceUri: vscode.Uri,
	sourceDirectoryUri: vscode.Uri,
): Promise<PairedDirectoryEntry[]> {
	const relativeDirectory = relativeSourcePath(workspaceUri, sourceDirectoryUri);
	const englishDirectory = vscode.Uri.joinPath(workspaceUri, '.langclarity', relativeDirectory);
	await assertPathHasNoSymlinks(workspaceUri, englishDirectory);
	const files: vscode.Uri[] = [];
	await collectEnglishFiles(englishDirectory, files);
	return files.flatMap((englishUri): PairedDirectoryEntry[] => {
		const relative = path.posix.relative(englishDirectory.path, englishUri.path);
		if (!relative.endsWith('.md')) {
			return [];
		}
		const childSourcePath = relative.slice(0, -'.md'.length);
		const sourceUri = vscode.Uri.joinPath(sourceDirectoryUri, childSourcePath);
		return isSupportedSource(sourceUri)
			? [{ childSourcePath, sourceUri, englishUri }]
			: [];
	});
}

function workspaceUriForEnglish(englishUri: vscode.Uri): vscode.Uri {
	const marker = '/.langclarity/';
	const markerIndex = englishUri.path.lastIndexOf(marker);
	if (markerIndex <= 0) {
		throw new Error('The English document is not inside a LangClarity workspace directory.');
	}
	return englishUri.with({ path: englishUri.path.slice(0, markerIndex), query: '', fragment: '' });
}

async function collectEnglishFiles(directory: vscode.Uri, files: vscode.Uri[]): Promise<void> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(directory);
	} catch (error) {
		if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
			return;
		}
		throw error;
	}
	for (const [name, type] of entries) {
		const child = vscode.Uri.joinPath(directory, name);
		if (type === vscode.FileType.Directory) {
			await collectEnglishFiles(child, files);
		} else if (type === vscode.FileType.File) {
			files.push(child);
		}
	}
}

async function moveClosedEnglishFile(
	oldEnglishUri: vscode.Uri,
	newEnglishUri: vscode.Uri,
	content: string,
): Promise<void> {
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(newEnglishUri, '..'));
	const staging = newEnglishUri.with({ path: `${newEnglishUri.path}.${randomUUID()}.tmp` });
	const backup = oldEnglishUri.with({ path: `${oldEnglishUri.path}.${randomUUID()}.tmp` });
	await vscode.workspace.fs.writeFile(staging, Buffer.from(content, 'utf8'));
	let backedUp = false;
	try {
		await vscode.workspace.fs.rename(oldEnglishUri, backup, { overwrite: false });
		backedUp = true;
		await vscode.workspace.fs.rename(staging, newEnglishUri, { overwrite: false });
	} catch (error) {
		if (backedUp) {
			await vscode.workspace.fs.rename(backup, oldEnglishUri, { overwrite: false });
		}
		try {
			await vscode.workspace.fs.delete(staging);
		} catch {
			// The staging file may already have been moved.
		}
		throw error;
	}
	try {
		await vscode.workspace.fs.delete(backup);
	} catch {
		// The destination is complete; a leftover backup is safer than failing the move.
	}
}

async function moveOpenEnglishDocument(
	document: vscode.TextDocument,
	newEnglishUri: vscode.Uri,
	original: string,
	updated: string,
): Promise<void> {
	const wasDirty = document.isDirty;
	const contentEdit = new vscode.WorkspaceEdit();
	contentEdit.replace(
		document.uri,
		new vscode.Range(new vscode.Position(0, 0), document.positionAt(original.length)),
		updated,
	);
	if (!await vscode.workspace.applyEdit(contentEdit)) {
		throw new Error('VS Code rejected the paired English metadata update');
	}
	try {
		await renameOpenDocument(document, newEnglishUri);
	} catch (error) {
		const rollbackDocument = findOpenDocument(document.uri);
		if (rollbackDocument?.getText() === updated) {
			const rollback = new vscode.WorkspaceEdit();
			rollback.replace(
				rollbackDocument.uri,
				new vscode.Range(new vscode.Position(0, 0), rollbackDocument.positionAt(updated.length)),
				original,
			);
			await vscode.workspace.applyEdit(rollback);
		}
		throw error;
	}
	if (!wasDirty) {
		const moved = findOpenDocument(newEnglishUri);
		if (!moved || !await moved.save()) {
			throw new Error('VS Code could not save the moved English interpretation');
		}
	}
}

async function renameOpenDocument(document: vscode.TextDocument, destination: vscode.Uri): Promise<vscode.TextDocument> {
	const expected = document.getText();
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(destination, '..'));
	if (samePathIgnoringCase(document.uri, destination)) {
		const originalUri = document.uri;
		const intermediate = originalUri.with({ path: `${originalUri.path}.${randomUUID()}.tmp` });
		const first = new vscode.WorkspaceEdit();
		first.renameFile(originalUri, intermediate, { overwrite: false });
		if (!await vscode.workspace.applyEdit(first)) {
			throw new Error('VS Code rejected the paired English move');
		}
		const second = new vscode.WorkspaceEdit();
		second.renameFile(intermediate, destination, { overwrite: false });
		if (await vscode.workspace.applyEdit(second)) {
			return movedOpenDocument(destination, expected);
		}
		const rollback = new vscode.WorkspaceEdit();
		rollback.renameFile(intermediate, originalUri, { overwrite: false });
		await vscode.workspace.applyEdit(rollback);
		throw new Error('VS Code rejected the paired English move');
	}
	const edit = new vscode.WorkspaceEdit();
	edit.renameFile(document.uri, destination, { overwrite: false });
	if (!await vscode.workspace.applyEdit(edit)) {
		throw new Error('VS Code rejected the paired English move');
	}
	return movedOpenDocument(destination, expected);
}

function movedOpenDocument(destination: vscode.Uri, expected: string): vscode.TextDocument {
	const moved = findOpenDocument(destination);
	if (!moved || moved.getText() !== expected) {
		throw new Error('VS Code did not preserve the open paired English document');
	}
	return moved;
}

function findOpenDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
	return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
}

function samePathIgnoringCase(left: vscode.Uri, right: vscode.Uri): boolean {
	return left.scheme === right.scheme && left.path.localeCompare(right.path, undefined, { sensitivity: 'accent' }) === 0;
}

function workspaceRootContaining(workspaceUri: vscode.Uri, sourceUri: vscode.Uri): vscode.Uri | undefined {
	try {
		relativeSourcePath(workspaceUri, sourceUri);
		return workspaceUri;
	} catch {
		return undefined;
	}
}

function isSupportedSource(uri: vscode.Uri): boolean {
	return uri.scheme === 'file' && supportedExtensions.has(path.posix.extname(uri.path).toLowerCase());
}

function languageIdFor(uri: vscode.Uri): string {
	switch (path.posix.extname(uri.path).toLowerCase()) {
		case '.ts': return 'typescript';
		case '.tsx': return 'typescriptreact';
		case '.js': return 'javascript';
		case '.jsx': return 'javascriptreact';
		default: throw new Error('unsupported source extension');
	}
}

function escapeCodeSpan(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`');
}
