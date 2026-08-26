import { parseEnglishDocument, type ParsedEnglishDocument } from './englishDocument';
import { escapeMarkdown, unescapeMarkdown } from './markdownText';

const generatedStart = '<!-- langclarity:generated:start relationships -->';

export interface PaneBehaviorItem {
	statement: string;
	evidence?: string;
	evidenceSuffix?: string;
	startLine?: number;
	endLine?: number;
	symbolName?: string;
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
			{ heading: 'Symbols', content: section(parsed.body, '## Symbols', '## Dependencies') },
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

export function replacePaneBehavior(markdown: string, items: PaneBehaviorItem[]): string {
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
	const updated = markdown.slice(0, heading.index + heading[0].length)
		+ `${eol}${eol}${behavior.replaceAll('\n', eol)}${eol}${eol}`
		+ markdown.slice(generatedIndex);
	parseEnglishDocument(updated);
	return updated;
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
	for (const item of items) {
		const first = item.startLine
			? Math.max(0, Math.min(rows.length - 1, item.startLine - 1))
			: 0;
		const last = item.endLine
			? Math.max(first, Math.min(rows.length - 1, item.endLine - 1))
			: rows.length - 1;
		let target = first;
		while (target <= last && rows[target].statement.length > 0) {
			target += 1;
		}
		if (target > last) {
			target = first;
		}
		if (rows[target].statement.length > 0) {
			const startLine = Math.min(rows[target].startLine ?? target + 1, item.startLine ?? target + 1);
			const endLine = Math.max(rows[target].endLine ?? target + 1, item.endLine ?? target + 1);
			rows[target] = {
				statement: `${rows[target].statement} ${singleLine(item.statement)}`,
				evidence: `Lines ${startLine}–${endLine}`,
				evidenceSuffix: `_(${startLine}–${endLine})_`,
				startLine,
				endLine,
			};
		} else {
			rows[target] = { ...rows[target], ...item, statement: singleLine(item.statement) };
		}
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
			...(match[5] ? { symbolName: unescapeMarkdown(match[5]) } : {}),
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
