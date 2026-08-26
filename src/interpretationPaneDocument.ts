import { parseEnglishDocument, type ParsedEnglishDocument } from './englishDocument';
import { escapeMarkdown, unescapeMarkdown } from './markdownText';

const generatedStart = '<!-- langclarity:generated:start relationships -->';

export interface PaneBehaviorItem {
	statement: string;
	evidence?: string;
	evidenceSuffix?: string;
	startLine?: number;
	endLine?: number;
	definitionName?: string;
}

export interface InterpretationPaneContent {
	source: string;
	model: string;
	interpretedAt: string;
	behavior: PaneBehaviorItem[];
	overview: Array<{ heading: string; content: string }>;
	structure: Array<{ heading: string; content: string }>;
	effects: Array<{ heading: string; content: string }>;
}

export function interpretationPaneContent(
	input: string | ParsedEnglishDocument,
): InterpretationPaneContent {
	const parsed = typeof input === 'string' ? parseEnglishDocument(input) : input;
	const keyDefinitionsHeading = parsed.body.includes('## Key definitions')
		? '## Key definitions'
		: '## Symbols';
	return {
		source: parsed.frontmatter.source,
		model: parsed.frontmatter.model,
		interpretedAt: parsed.frontmatter.interpretedAt,
		behavior: parseBehavior(section(parsed.body, '## Behavior', generatedStart))
			.sort(comparePaneBehavior),
		overview: [
			{ heading: 'Purpose', content: section(parsed.body, '## Purpose', '## Responsibilities') },
			{ heading: 'Responsibilities', content: section(parsed.body, '## Responsibilities', '## Behavior') },
		],
		structure: [
			{ heading: 'Key definitions', content: section(parsed.body, keyDefinitionsHeading, '## Dependencies') },
			{ heading: 'Dependencies', content: section(parsed.body, '## Dependencies', '## Related files') },
			{ heading: 'Related files', content: section(parsed.body, '## Related files', '## Related tests') },
			{ heading: 'Related tests', content: section(parsed.body, '## Related tests', '<!-- langclarity:generated:end relationships -->') },
		],
		effects: [
			{ heading: 'Side effects', content: section(parsed.body, '## Side effects', '## Constraints') },
			{ heading: 'Constraints', content: parsed.body.slice(
				parsed.body.indexOf('## Constraints') + '## Constraints'.length,
			).trim() },
		],
	};
}

export interface PaneBehaviorSectionEdit {
	startOffset: number;
	endOffset: number;
	replacement: string;
	updatedText: string;
}

export function paneBehaviorSectionEdit(
	markdown: string,
	items: PaneBehaviorItem[],
): PaneBehaviorSectionEdit {
	const heading = /^## Behavior\r?$/mu.exec(markdown);
	const generatedIndex = markdown.indexOf(generatedStart, (heading?.index ?? 0) + (heading?.[0].length ?? 0));
	if (!heading || generatedIndex < 0) {
		throw new Error('The English document is missing its Behavior section.');
	}

	const cleaned = items
		.map((item) => ({ ...item, statement: singleLine(item.statement) }));
	const behavior = cleaned.length === 0
		? '_None identified._'
		: cleaned.map((item, index) => {
			const suffix = item.evidenceSuffix ? ` ${item.evidenceSuffix}` : '';
			return `${index + 1}. ${escapeMarkdown(item.statement)}${suffix}`;
		}).join('\n');
	const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
	const startOffset = heading.index + heading[0].length;
	const endOffset = generatedIndex;
	const replacement = `${eol}${eol}${behavior.replaceAll('\n', eol)}${eol}${eol}`;
	return {
		startOffset,
		endOffset,
		replacement,
		updatedText: markdown.slice(0, startOffset) + replacement + markdown.slice(endOffset),
	};
}

export function replacePaneBehavior(markdown: string, items: PaneBehaviorItem[]): string {
	return paneBehaviorSectionEdit(markdown, items).updatedText;
}

export function behaviorRowsForSource(
	items: PaneBehaviorItem[],
	sourceLineCount: number,
): PaneBehaviorItem[] {
	const rows = Array.from(
		{ length: Math.max(1, sourceLineCount) },
		(_, index): PaneBehaviorItem => ({
			statement: '',
			startLine: index + 1,
			endLine: index + 1,
			evidenceSuffix: `_(${index + 1}–${index + 1})_`,
		}),
	);
	for (const [itemIndex, item] of items.entries()) {
		const sourceLine = item.startLine ?? item.endLine ?? (itemIndex + 1);
		const index = Math.max(0, Math.min(rows.length - 1, sourceLine - 1));
		const line = index + 1;
		rows[index] = {
			...rows[index],
			...item,
			statement: singleLine(item.statement),
			startLine: line,
			endLine: line,
			evidenceSuffix: item.evidenceSuffix ?? `_(${line}–${line})_`,
		};
	}
	return rows;
}

function parseBehavior(value: string): PaneBehaviorItem[] {
	const trimmed = value.trim();
	if (trimmed === '' || trimmed === '_None identified._') {
		return [];
	}
	const rawItems: string[] = [];
	for (const line of trimmed.split('\n')) {
		if (/^\d+\. /u.test(line)) {
			rawItems.push(line);
		} else if (/^ {3}/u.test(line) && rawItems.length > 0) {
			rawItems[rawItems.length - 1] += `\n${line}`;
		} else {
			throw new Error('The Behavior section cannot be edited in the LangClarity pane. Open the Markdown to repair it.');
		}
	}
	return rawItems.map((item) => {
		const match = item.match(/^\d+\. ([\s\S]*?)(?: (_\((\d+)–(\d+)(?:; symbol `(.+)`)?\)_))?$/u);
		if (!match) {
			throw new Error('The Behavior section cannot be edited in the LangClarity pane. Open the Markdown to repair it.');
		}
		const evidence = match[2]
			? `Lines ${match[3]}–${match[4]}${match[5] ? ` · ${unescapeMarkdown(match[5])}` : ''}`
			: undefined;
		return {
			statement: unescapeMarkdown(match[1].replaceAll('\n   ', '\n')),
			...(evidence ? { evidence } : {}),
			...(match[2] ? { evidenceSuffix: match[2] } : {}),
			...(match[3] ? { startLine: Number(match[3]) } : {}),
			...(match[4] ? { endLine: Number(match[4]) } : {}),
			...(match[5] ? { definitionName: unescapeMarkdown(match[5]) } : {}),
		};
	});
}

function comparePaneBehavior(left: PaneBehaviorItem, right: PaneBehaviorItem): number {
	return (left.endLine ?? Number.MAX_SAFE_INTEGER) - (right.endLine ?? Number.MAX_SAFE_INTEGER)
		|| (left.startLine ?? Number.MAX_SAFE_INTEGER) - (right.startLine ?? Number.MAX_SAFE_INTEGER);
}

function singleLine(value: string): string {
	return value.split(/\r\n|\r|\n/gu)
		.map((part, index) => index === 0 ? part.trimEnd() : part.trim())
		.join(' ')
		.trimEnd();
}

function section(body: string, startHeading: string, endHeading: string): string {
	const startIndex = body.indexOf(startHeading);
	const endIndex = body.indexOf(endHeading, startIndex + startHeading.length);
	if (startIndex < 0 || endIndex < 0) {
		throw new Error(`The English document is missing ${startHeading}.`);
	}
	return body.slice(startIndex + startHeading.length, endIndex).trim();
}
