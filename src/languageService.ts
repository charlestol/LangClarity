import path from 'node:path';
import type * as TypeScript from 'typescript';

let typescriptPromise: Promise<typeof TypeScript> | undefined;

export interface SyntaxIssue {
	message: string;
	line: number;
	column: number;
}

export interface MinimalReplacement {
	startOffset: number;
	endOffset: number;
	newText: string;
}

export async function syntaxIssues(source: string, filePath: string): Promise<SyntaxIssue[]> {
	const ts = await loadTypeScript();
	const sourceFile = ts.createSourceFile(
		path.posix.basename(filePath),
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind(ts, filePath),
	);
	const diagnostics = (sourceFile as TypeScript.SourceFile & {
		parseDiagnostics: readonly TypeScript.DiagnosticWithLocation[];
	}).parseDiagnostics;
	return diagnostics.map((diagnostic) => {
		const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start);
		return {
			message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
			line: position.line + 1,
			column: position.character + 1,
		};
	});
}

export function preserveSourceStyle(base: string, proposed: string): string {
	const baseHasBom = base.charCodeAt(0) === 0xFEFF;
	const withoutBom = proposed.charCodeAt(0) === 0xFEFF ? proposed.slice(1) : proposed;
	const normalized = withoutBom.replace(/\r\n|\r/gu, '\n');
	const baseTrailingNewlines = base.match(/(?:\r\n|\r|\n)+$/u)?.[0] ?? '';
	const withoutTrailingNewlines = normalized.replace(/\n+$/u, '');
	const withTrailingStyle = withoutTrailingNewlines + baseTrailingNewlines;
	const styled = base.includes('\r\n')
		? withTrailingStyle.replace(/(?<!\r)\n/gu, '\r\n')
		: withTrailingStyle;
	return baseHasBom ? `\uFEFF${styled}` : styled;
}

export function minimalReplacement(base: string, proposed: string): MinimalReplacement | undefined {
	if (base === proposed) {
		return undefined;
	}
	let startOffset = 0;
	while (startOffset < base.length
		&& startOffset < proposed.length
		&& base[startOffset] === proposed[startOffset]) {
		startOffset += 1;
	}
	if (splitsSurrogatePair(base, startOffset) || splitsSurrogatePair(proposed, startOffset)) {
		startOffset -= 1;
	}

	let suffixLength = 0;
	while (suffixLength < base.length - startOffset
		&& suffixLength < proposed.length - startOffset
		&& base[base.length - 1 - suffixLength] === proposed[proposed.length - 1 - suffixLength]) {
		suffixLength += 1;
	}
	let endOffset = base.length - suffixLength;
	let proposedEndOffset = proposed.length - suffixLength;
	if (splitsSurrogatePair(base, endOffset) || splitsSurrogatePair(proposed, proposedEndOffset)) {
		endOffset += 1;
		proposedEndOffset += 1;
	}

	return {
		startOffset,
		endOffset,
		newText: proposed.slice(startOffset, proposedEndOffset),
	};
}

function loadTypeScript(): Promise<typeof TypeScript> {
	typescriptPromise ??= import('typescript');
	return typescriptPromise;
}

function scriptKind(ts: typeof TypeScript, filePath: string): TypeScript.ScriptKind {
	switch (path.posix.extname(filePath).toLowerCase()) {
		case '.ts': return ts.ScriptKind.TS;
		case '.tsx': return ts.ScriptKind.TSX;
		case '.js': return ts.ScriptKind.JS;
		case '.jsx': return ts.ScriptKind.JSX;
		default: return ts.ScriptKind.Unknown;
	}
}

function splitsSurrogatePair(value: string, offset: number): boolean {
	if (offset <= 0 || offset >= value.length) {
		return false;
	}
	const previous = value.charCodeAt(offset - 1);
	const current = value.charCodeAt(offset);
	return previous >= 0xD800 && previous <= 0xDBFF
		&& current >= 0xDC00 && current <= 0xDFFF;
}
