import path from 'node:path';
import * as vscode from 'vscode';
import { hashEditableBody, renderFrontmatter } from './englishDocument';
import { escapeMarkdown } from './markdownText';
import { isRecord } from './typeGuards';

export { hashText } from './hash';

export const MAX_SOURCE_BYTES = 75 * 1024;
export const MAX_SOURCE_LINES = 2_000;
export const MAX_ENGLISH_BYTES = 256 * 1024;

export function codeToEnglishSchema(sourceLineCount: number): Record<string, unknown> {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['purpose', 'responsibilities', 'behavior', 'sideEffects', 'constraints'],
		properties: {
			purpose: { type: 'string' },
			responsibilities: { type: 'array', items: { type: 'string' } },
			behavior: {
				type: 'array',
				minItems: sourceLineCount,
				maxItems: sourceLineCount,
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['sourceLine', 'statement'],
					properties: {
						sourceLine: { type: 'integer', minimum: 1, maximum: sourceLineCount },
						statement: { type: 'string', maxLength: 500 },
					},
				},
			},
			sideEffects: { type: 'array', items: { type: 'string' } },
			constraints: { type: 'array', items: { type: 'string' } },
		},
	};
}

export interface EnglishCodeLine {
	statement: string;
	sourceLine: number;
}

export interface InterpretationResult {
	purpose: string;
	responsibilities: string[];
	behavior: EnglishCodeLine[];
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

function isEnglishCodeLine(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length <= 500
		&& !/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
}

export function validateInterpretation(value: unknown, source: string | number): InterpretationResult {
	const sourceLines = typeof source === 'string' ? source.split(/\r\n|\r|\n/u) : undefined;
	const sourceLineCount = sourceLines?.length ?? source;
	if (!isRecord(value)
		|| !hasExactKeys(value, ['purpose', 'responsibilities', 'behavior', 'sideEffects', 'constraints'])
		|| !isPlainText(value.purpose)
		|| !isStringArray(value.responsibilities)
		|| !isStringArray(value.sideEffects)
		|| !isStringArray(value.constraints)
		|| !Array.isArray(value.behavior)
		|| value.behavior.length !== sourceLineCount) {
		throw new Error('Codex returned an invalid interpretation.');
	}

	const behavior = value.behavior.map((item, index): EnglishCodeLine => {
		const sourceIsBlank = sourceLines?.[index].trim().length === 0;
		if (!isRecord(item)
			|| !hasExactKeys(item, ['sourceLine', 'statement'])
			|| !isEnglishCodeLine(item.statement)
			|| item.sourceLine !== index + 1
			|| (sourceIsBlank === true && item.statement !== '')
			|| (sourceIsBlank === false && item.statement.trim().length === 0)) {
			throw new Error('Codex returned an invalid interpretation.');
		}
		return {
			statement: item.statement,
			sourceLine: item.sourceLine as number,
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

export function sourceAccessError(document: vscode.TextDocument): string | undefined {
	if (!supportedLanguageIds.has(document.languageId)
		|| !supportedExtensions.has(path.posix.extname(document.uri.path).toLowerCase())) {
		return 'LangClarity MVP supports TypeScript and JavaScript files (.ts, .tsx, .js, and .jsx).';
	}
	if (document.uri.scheme !== 'file') {
		return 'LangClarity requires a saved file inside the current workspace.';
	}
	return undefined;
}

export function sourceEligibilityError(document: vscode.TextDocument): string | undefined {
	const accessError = sourceAccessError(document);
	if (accessError) {
		return accessError;
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
			return `${index + 1}. ${escapeMarkdown(item.statement)} _(${item.sourceLine}–${item.sourceLine})_`;
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
		'## Key definitions',
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
		promptVersion: '6',
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
