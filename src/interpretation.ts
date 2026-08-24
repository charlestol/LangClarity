import path from 'node:path';
import * as vscode from 'vscode';
import { hashEditableBody, renderFrontmatter } from './englishDocument';
import { hashText } from './hash';

export { hashText } from './hash';

export const MAX_SOURCE_BYTES = 75 * 1024;
export const MAX_SOURCE_LINES = 2_000;

export const codeToEnglishSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['purpose', 'responsibilities', 'behavior', 'sideEffects', 'constraints'],
	properties: {
		purpose: { type: 'string' },
		responsibilities: { type: 'array', items: { type: 'string' } },
		behavior: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['statement', 'evidence'],
				properties: {
					statement: { type: 'string' },
					evidence: {
						type: 'object',
						additionalProperties: false,
						required: ['startLine', 'endLine', 'symbolName'],
						properties: {
							startLine: { type: 'integer', minimum: 1 },
							endLine: { type: 'integer', minimum: 1 },
							symbolName: { type: 'string' },
						},
					},
				},
			},
		},
		sideEffects: { type: 'array', items: { type: 'string' } },
		constraints: { type: 'array', items: { type: 'string' } },
	},
} as const;

export interface BehaviorItem {
	statement: string;
	evidence: {
		startLine: number;
		endLine: number;
		symbolName: string;
	};
}

export interface InterpretationResult {
	purpose: string;
	responsibilities: string[];
	behavior: BehaviorItem[];
	sideEffects: string[];
	constraints: string[];
}

export interface RenderInterpretationInput {
	result: InterpretationResult;
	sourcePath: string;
	sourceHash: string;
	languageId: string;
	model: string;
	interpretedAt: string;
}

const supportedLanguageIds = new Set([
	'typescript',
	'typescriptreact',
	'javascript',
	'javascriptreact',
]);
const supportedExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
	const keys = Object.keys(value).sort();
	const expectedKeys = [...expected].sort();
	return keys.length === expected.length
		&& keys.every((key, index) => key === expectedKeys[index]);
}

function isPlainText(value: unknown, maximumLength = 1_000): value is string {
	return typeof value === 'string'
		&& value.trim().length > 0
		&& value.length <= maximumLength
		&& !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.length <= 100
		&& value.every((item) => isPlainText(item, 500));
}

export function validateInterpretation(value: unknown, sourceLineCount: number): InterpretationResult {
	if (!isRecord(value)
		|| !hasExactKeys(value, ['purpose', 'responsibilities', 'behavior', 'sideEffects', 'constraints'])
		|| !isPlainText(value.purpose)
		|| !isStringArray(value.responsibilities)
		|| !isStringArray(value.sideEffects)
		|| !isStringArray(value.constraints)
		|| !Array.isArray(value.behavior)
		|| value.behavior.length > 200) {
		throw new Error('Codex returned an invalid interpretation.');
	}

	const behavior = value.behavior.map((item): BehaviorItem => {
		if (!isRecord(item)
			|| !hasExactKeys(item, ['statement', 'evidence'])
			|| !isPlainText(item.statement, 500)
			|| !isRecord(item.evidence)
			|| !hasExactKeys(item.evidence, ['startLine', 'endLine', 'symbolName'])) {
			throw new Error('Codex returned an invalid interpretation.');
		}

		const { startLine, endLine, symbolName } = item.evidence;
		if (!Number.isInteger(startLine)
			|| !Number.isInteger(endLine)
			|| (startLine as number) < 1
			|| (endLine as number) < (startLine as number)
			|| (endLine as number) > sourceLineCount
			|| typeof symbolName !== 'string'
			|| symbolName.length > 200
			|| /[\r\n]/u.test(symbolName)) {
			throw new Error('Codex returned an interpretation with invalid source evidence.');
		}

		return {
			statement: item.statement,
			evidence: {
				startLine: startLine as number,
				endLine: endLine as number,
				symbolName,
			},
		};
	});

	return {
		purpose: value.purpose,
		responsibilities: value.responsibilities,
		behavior,
		sideEffects: value.sideEffects,
		constraints: value.constraints,
	};
}

export function sourceEligibilityError(document: vscode.TextDocument): string | undefined {
	if (!supportedLanguageIds.has(document.languageId)
		|| !supportedExtensions.has(path.posix.extname(document.uri.path).toLowerCase())) {
		return 'LangClarity MVP supports TypeScript and JavaScript files (.ts, .tsx, .js, and .jsx).';
	}
	if (document.uri.scheme !== 'file') {
		return 'LangClarity requires a saved file inside the current workspace.';
	}

	const text = document.getText();
	if (Buffer.byteLength(text, 'utf8') > MAX_SOURCE_BYTES) {
		return 'This file exceeds the LangClarity MVP limit of 75 KiB.';
	}
	if (lineCount(text) > MAX_SOURCE_LINES) {
		return 'This file exceeds the LangClarity MVP limit of 2,000 lines.';
	}
	return undefined;
}

export function lineCount(text: string): number {
	return text.length === 0 ? 1 : text.split(/\r\n|\r|\n/u).length;
}

export function relativeSourcePath(workspaceUri: vscode.Uri, sourceUri: vscode.Uri): string {
	const relative = path.posix.relative(workspaceUri.path, sourceUri.path);
	if (relative === '' || relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) {
		throw new Error('The source file must be inside the current workspace.');
	}
	return relative;
}

export function englishUriFor(workspaceUri: vscode.Uri, sourceUri: vscode.Uri): vscode.Uri {
	const relative = relativeSourcePath(workspaceUri, sourceUri);
	return vscode.Uri.joinPath(workspaceUri, '.langclarity', `${relative}.md`);
}

function escapeMarkdown(text: string): string {
	return text
		.replaceAll('\\', '\\\\')
		.replaceAll('&', '&amp;')
		.replaceAll('`', '\\`')
		.replaceAll('[', '\\[')
		.replaceAll(']', '\\]')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function renderList(items: string[]): string {
	return items.length === 0
		? '_None identified._'
		: items.map((item) => `- ${escapeMarkdown(item)}`).join('\n');
}

export function renderInterpretation(input: RenderInterpretationInput): string {
	const { result } = input;
	const behavior = result.behavior.length === 0
		? '_None identified._'
		: result.behavior.map((item, index) => {
			const symbol = item.evidence.symbolName.length > 0
				? `; symbol \`${escapeMarkdown(item.evidence.symbolName)}\``
				: '';
			return `${index + 1}. ${escapeMarkdown(item.statement)} _(${item.evidence.startLine}–${item.evidence.endLine}${symbol})_`;
		}).join('\n');

	const body = [
		'',
		`# \`${escapeMarkdown(input.sourcePath)}\``,
		'',
		'## Purpose',
		'',
		escapeMarkdown(result.purpose),
		'',
		'## Responsibilities',
		'',
		renderList(result.responsibilities),
		'',
		'## Behavior',
		'',
		behavior,
		'',
		'<!-- langclarity:generated:start relationships -->',
		'## Symbols',
		'',
		'## Dependencies',
		'',
		'## Related files',
		'',
		'## Related tests',
		'<!-- langclarity:generated:end relationships -->',
		'',
		'## Side effects',
		'',
		renderList(result.sideEffects),
		'',
		'## Constraints',
		'',
		renderList(result.constraints),
		'',
	].join('\n');
	return renderFrontmatter({
		schemaVersion: 1,
		source: input.sourcePath,
		sourceHash: input.sourceHash,
		editableEnglishHash: hashEditableBody(body),
		languageId: input.languageId,
		promptVersion: '1',
		model: input.model,
		interpretedAt: input.interpretedAt,
	}, body);
}

export function numberedSource(text: string): string {
	return text
		.split(/\r\n|\r|\n/u)
		.map((line, index) => `${String(index + 1).padStart(4, ' ')}: ${line}`)
		.join('\n');
}
