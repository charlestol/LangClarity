import * as vscode from 'vscode';
import {
	AuthenticationRequiredError,
	CodexResponseError,
	UsageLimitedError,
} from './codexInterpreter';
import {
	MAX_ENGLISH_BYTES,
	sourceLimitError,
} from './interpretation';
import { operationStartError } from './operationPolicy';

export async function requireTrustedWorkspace(message: string): Promise<boolean> {
	if (vscode.workspace.isTrusted) {
		return true;
	}
	await vscode.window.showErrorMessage(message);
	return false;
}

export async function ensureSourceWithinLimits(sourceText: string): Promise<boolean> {
	const error = sourceLimitError(sourceText);
	if (error) {
		await vscode.window.showErrorMessage(error);
		return false;
	}
	return true;
}

export async function ensureEnglishWithinLimits(englishText: string): Promise<boolean> {
	if (Buffer.byteLength(englishText, 'utf8') > MAX_ENGLISH_BYTES) {
		await vscode.window.showErrorMessage(
			'The English document exceeds the LangClarity MVP limit of 256 KiB.',
		);
		return false;
	}
	return true;
}

export async function withCodexProgress<T>(
	title: string,
	run: (
		progress: vscode.Progress<{ message?: string }>,
		cancellationToken: vscode.CancellationToken,
	) => Promise<T>,
): Promise<T> {
	return vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title,
		cancellable: true,
	}, run);
}

export function codexRetryReporter(
	progress: vscode.Progress<{ message?: string }>,
): () => void {
	return () => progress.report({ message: 'Codex is retrying.' });
}

interface RunModelCommandOptions {
	output: vscode.OutputChannel;
	pendingSources: Set<string>;
	sourceKey: string;
	fileName: string;
	operation: string;
	cancelledMessage: string;
	failureFallback: string;
	retryCommand: string;
	retryArgs?: unknown;
	run: () => Promise<void>;
}

/**
 * Claims the source in pendingSources, runs the operation, handles cancel /
 * failure reporting, and re-enters the command on Retry.
 */
export async function runModelCommand(options: RunModelCommandOptions): Promise<void> {
	const startError = operationStartError(options.pendingSources, options.sourceKey);
	if (startError) {
		await vscode.window.showInformationMessage(startError);
		return;
	}
	options.pendingSources.add(options.sourceKey);
	let retryRequested = false;
	try {
		await options.run();
	} catch (error) {
		if (error instanceof vscode.CancellationError) {
			options.output.appendLine(`${options.operation}:cancelled file=${options.fileName}`);
			await vscode.window.showInformationMessage(options.cancelledMessage);
			return;
		}
		retryRequested = await reportOperationFailure(
			options.output,
			options.operation,
			options.fileName,
			error,
			options.failureFallback,
		);
	} finally {
		options.pendingSources.delete(options.sourceKey);
	}
	if (retryRequested) {
		await vscode.commands.executeCommand(options.retryCommand, options.retryArgs);
	}
}

export async function reportOperationFailure(
	output: vscode.OutputChannel,
	operation: string,
	fileName: string,
	error: unknown,
	fallback: string,
): Promise<boolean> {
	const message = error instanceof Error ? error.message : fallback;
	const category = error instanceof UsageLimitedError
		? 'usage-limited'
		: error instanceof AuthenticationRequiredError
			? 'authentication'
			: error instanceof CodexResponseError
				? 'codex'
				: 'langclarity';
	output.appendLine(`${operation}:failed category=${category} file=${fileName}`);
	return await vscode.window.showErrorMessage(message, 'Retry') === 'Retry';
}
