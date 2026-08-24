import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as vscode from 'vscode';
import type { CodeChangeResult } from './codexInterpreter';
import { hashText } from './hash';
import { lineCount, MAX_SOURCE_BYTES, MAX_SOURCE_LINES } from './interpretation';
import {
	minimalReplacement,
	preserveSourceStyle,
	syntaxIssues,
	type SyntaxIssue,
} from './languageService';
import { SessionCoordinator, type SessionCapture } from './sessionCoordinator';

const proposalScheme = 'langclarity-proposal';

interface PendingProposal {
	id: string;
	sourceUri: vscode.Uri;
	englishUri: vscode.Uri;
	proposalUri: vscode.Uri;
	baseSourceHash: string;
	baseEnglishDocumentHash: string;
	proposedSource: string;
	proposedSourceHash: string;
	summary: string;
	syntaxErrors: SyntaxIssue[];
	diagnostics: vscode.Diagnostic[];
}

export class ProposalCoordinator implements vscode.Disposable {
	private readonly provider = new ProposalDocumentProvider();
	private readonly disposables: vscode.Disposable[];
	private readonly proposalsBySource = new Map<string, PendingProposal>();

	constructor(
		private readonly sessions: SessionCoordinator,
		private readonly output: vscode.OutputChannel,
	) {
		this.disposables = [
			this.provider,
			vscode.workspace.registerTextDocumentContentProvider(proposalScheme, this.provider),
		];
	}

	async review(capture: SessionCapture, result: CodeChangeResult): Promise<void> {
		this.discardForSource(capture.sourceUri);
		const proposedSource = preserveSourceStyle(capture.sourceText, result.proposedSource);
		if (Buffer.byteLength(proposedSource, 'utf8') > MAX_SOURCE_BYTES
			|| lineCount(proposedSource) > MAX_SOURCE_LINES) {
			throw new Error('Codex proposed source that exceeds the LangClarity MVP limit of 75 KiB or 2,000 lines.');
		}
		if (proposedSource === capture.sourceText) {
			throw new Error('Codex proposed no source changes.');
		}
		const id = randomUUID();
		const proposalUri = vscode.Uri.from({
			scheme: proposalScheme,
			path: capture.sourceUri.path,
			query: `id=${id}`,
		});
		const proposal: PendingProposal = {
			id,
			sourceUri: capture.sourceUri,
			englishUri: capture.englishUri,
			proposalUri,
			baseSourceHash: capture.sourceHash,
			baseEnglishDocumentHash: capture.englishDocumentHash,
			proposedSource,
			proposedSourceHash: hashText(proposedSource),
			summary: result.summary,
			syntaxErrors: await syntaxIssues(proposedSource, capture.sourceUri.path),
			diagnostics: [],
		};
		this.proposalsBySource.set(capture.sourceUri.toString(), proposal);
		this.provider.set(proposalUri, proposedSource);

		const proposalDocument = await vscode.workspace.openTextDocument(proposalUri);
		if (proposalDocument.languageId !== capture.parsedEnglish.frontmatter.languageId) {
			await vscode.languages.setTextDocumentLanguage(
				proposalDocument,
				capture.parsedEnglish.frontmatter.languageId,
			);
		}
		await vscode.commands.executeCommand(
			'vscode.diff',
			capture.sourceUri,
			proposalUri,
			`LangClarity Proposal: ${path.posix.basename(capture.sourceUri.path)}`,
			{ preview: true },
		);

		if (proposal.syntaxErrors.length > 0) {
			const first = proposal.syntaxErrors[0];
			this.output.appendLine(
				`proposal:blocked reason=syntax count=${proposal.syntaxErrors.length} file=${path.posix.basename(capture.sourceUri.path)}`,
			);
			await vscode.window.showErrorMessage(
				`LangClarity proposal has ${proposal.syntaxErrors.length} syntax error(s) and cannot be applied. First error at ${first.line}:${first.column}: ${first.message}`,
			);
			return;
		}

		proposal.diagnostics = await collectProposalDiagnostics(proposalDocument);
		const diagnostics = proposal.diagnostics.length;
		const affectedLines = diagnosticLines(proposal.diagnostics);
		const action = diagnostics > 0
			? await vscode.window.showWarningMessage(
				`Codex proposal: ${proposal.summary} VS Code reports ${diagnostics} proposal diagnostic(s) on ${affectedLines}. Review the diff before applying.`,
				'Apply Anyway',
				'Cancel',
			)
			: await vscode.window.showInformationMessage(
				`Codex proposal: ${proposal.summary} Review the diff before applying.`,
				'Apply',
				'Cancel',
			);
		if (action === 'Apply' || action === 'Apply Anyway') {
			await this.apply(proposal);
			return;
		}
		this.discard(proposal);
	}

	dispose(): void {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		this.proposalsBySource.clear();
	}

	private async apply(proposal: PendingProposal): Promise<void> {
		const current = await this.sessions.captureForSource(proposal.sourceUri);
		if (!current
			|| current.sourceHash !== proposal.baseSourceHash
			|| current.englishDocumentHash !== proposal.baseEnglishDocumentHash) {
			this.discard(proposal);
			throw new Error('Code or English changed after this proposal was created. Generate a new proposal.');
		}

		const sourceDocument = await vscode.workspace.openTextDocument(proposal.sourceUri);
		const englishDocument = await vscode.workspace.openTextDocument(proposal.englishUri);
		const replacement = minimalReplacement(current.sourceText, proposal.proposedSource);
		if (!replacement) {
			this.discard(proposal);
			throw new Error('The proposed source no longer contains a change.');
		}
		const edit = new vscode.WorkspaceEdit();
		edit.replace(
			proposal.sourceUri,
			new vscode.Range(
				sourceDocument.positionAt(replacement.startOffset),
				sourceDocument.positionAt(replacement.endOffset),
			),
			replacement.newText,
		);
		addFrontmatterValueEdit(edit, englishDocument, 'sourceHash', proposal.proposedSourceHash);
		addFrontmatterValueEdit(edit, englishDocument, 'editableEnglishHash', current.editableEnglishHash);

		const applied = await vscode.workspace.applyEdit(edit);
		if (!applied) {
			throw new Error('VS Code rejected the proposal edit. No synchronized baseline was updated.');
		}
		if (hashText(sourceDocument.getText()) !== proposal.proposedSourceHash) {
			throw new Error('The source changed while the proposal was being applied. Synchronization was not finalized.');
		}
		const refreshed = await this.sessions.reload(proposal.sourceUri);
		if (refreshed?.state !== 'SYNCED') {
			throw new Error('The proposal was applied, but the synchronized baselines could not be verified.');
		}
		this.output.appendLine(`proposal:applied file=${path.posix.basename(proposal.sourceUri.path)}`);
		this.discard(proposal);
		await vscode.window.showInformationMessage('LangClarity applied the approved proposal. Save the source and English files when ready.');
	}

	private discardForSource(sourceUri: vscode.Uri): void {
		const existing = this.proposalsBySource.get(sourceUri.toString());
		if (existing) {
			this.discard(existing);
		}
	}

	private discard(proposal: PendingProposal): void {
		this.proposalsBySource.delete(proposal.sourceUri.toString());
		this.provider.delete(proposal.proposalUri);
	}
}

class ProposalDocumentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private readonly documents = new Map<string, string>();
	private readonly changes = new vscode.EventEmitter<vscode.Uri>();
	readonly onDidChange = this.changes.event;

	provideTextDocumentContent(uri: vscode.Uri): string {
		return this.documents.get(uri.toString()) ?? '';
	}

	set(uri: vscode.Uri, content: string): void {
		this.documents.set(uri.toString(), content);
		this.changes.fire(uri);
	}

	delete(uri: vscode.Uri): void {
		this.documents.delete(uri.toString());
		this.changes.fire(uri);
	}

	dispose(): void {
		this.changes.dispose();
		this.documents.clear();
	}
}

function addFrontmatterValueEdit(
	edit: vscode.WorkspaceEdit,
	document: vscode.TextDocument,
	key: string,
	value: string,
): void {
	const text = document.getText();
	const pattern = new RegExp(`^${key}: (.+)$`, 'gmu');
	const matches = [...text.matchAll(pattern)];
	if (matches.length !== 1 || matches[0].index === undefined) {
		throw new Error(`The English document is missing a valid ${key} field.`);
	}
	const match = matches[0];
	const valueOffset = match.index + `${key}: `.length;
	edit.replace(
		document.uri,
		new vscode.Range(
			document.positionAt(valueOffset),
			document.positionAt(valueOffset + match[1].length),
		),
		JSON.stringify(value),
	);
}

async function collectProposalDiagnostics(document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	try {
		await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri);
	} catch {
		// Diagnostics remain best-effort; syntax validation is deterministic and separate.
	}
	return vscode.languages.getDiagnostics(document.uri)
		.filter((diagnostic) => diagnostic.severity === vscode.DiagnosticSeverity.Error
			|| diagnostic.severity === vscode.DiagnosticSeverity.Warning);
}

function diagnosticLines(diagnostics: vscode.Diagnostic[]): string {
	const lines = [...new Set(diagnostics.map((diagnostic) => diagnostic.range.start.line + 1))];
	const visible = lines.slice(0, 5).join(', ');
	return lines.length > 5 ? `lines ${visible}, and ${lines.length - 5} more` : `line${lines.length === 1 ? '' : 's'} ${visible}`;
}
