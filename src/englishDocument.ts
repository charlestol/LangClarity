import { hashText } from './hash';
import { unescapeMarkdown } from './markdownText';

const generatedStart = '<!-- langclarity:generated:start relationships -->';
const generatedEnd = '<!-- langclarity:generated:end relationships -->';
const requiredHeadings = [
	'## Purpose',
	'## Responsibilities',
	'## Behavior',
	'## Side effects',
	'## Constraints',
];
const allowedFrontmatterKeys = new Set([
	'schemaVersion',
	'source',
	'sourceHash',
	'editableEnglishHash',
	'mappingRevisionHash',
	'languageId',
	'promptVersion',
	'model',
	'interpretedAt',
]);
const supportedLanguageIds = new Set([
	'typescript',
	'typescriptreact',
	'javascript',
	'javascriptreact',
]);

export type StableSyncState = 'SYNCED' | 'CODE_CHANGED' | 'ENGLISH_CHANGED' | 'BOTH_CHANGED';

export interface InterpretationFrontmatter {
	schemaVersion: 1;
	source: string;
	sourceHash: string;
	editableEnglishHash: string;
	mappingRevisionHash?: string;
	languageId: string;
	promptVersion: string;
	model: string;
	interpretedAt: string;
}

export interface ParsedEnglishDocument {
	frontmatter: InterpretationFrontmatter;
	body: string;
	currentEnglishHashes: string[];
}

export function parseEnglishDocument(markdown: string): ParsedEnglishDocument {
	const normalized = normalizeNewlines(markdown);
	if (!normalized.startsWith('---\n')) {
		throw new Error('The English document is missing its LangClarity frontmatter.');
	}
	const closingIndex = normalized.indexOf('\n---\n', 4);
	if (closingIndex < 0) {
		throw new Error('The English document has malformed LangClarity frontmatter.');
	}

	const rawFrontmatter = normalized.slice(4, closingIndex);
	const body = normalized.slice(closingIndex + 5);
	const values = parseFrontmatter(rawFrontmatter);
	const frontmatter = validateFrontmatter(values);
	validateBody(body);

	const currentEnglishHashes = [hashEditableBody(body)];
	const legacyHash = legacyEditableEnglishHash(body);
	if (legacyHash && !currentEnglishHashes.includes(legacyHash)) {
		currentEnglishHashes.push(legacyHash);
	}
	return { frontmatter, body, currentEnglishHashes };
}

export function hashEditableBody(body: string): string {
	const normalized = normalizeNewlines(body);
	const startIndex = normalized.indexOf(generatedStart);
	const endIndex = normalized.indexOf(generatedEnd);
	if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
		throw new Error('The English document has malformed generated-section boundaries.');
	}
	if (normalized.indexOf(generatedStart, startIndex + generatedStart.length) >= 0
		|| normalized.indexOf(generatedEnd, endIndex + generatedEnd.length) >= 0) {
		throw new Error('The English document has duplicate generated-section boundaries.');
	}
	const editable = normalized.slice(0, startIndex)
		+ normalized.slice(endIndex + generatedEnd.length);
	const withoutGeneratedTitle = editable.replace(/^# .+\n/mu, '');
	return hashText(withoutGeneratedTitle);
}

export function deriveSyncState(
	currentSourceHash: string,
	baselineSourceHash: string,
	currentEnglishHashes: string[],
	baselineEnglishHash: string,
): StableSyncState {
	const codeChanged = currentSourceHash !== baselineSourceHash;
	const englishChanged = !currentEnglishHashes.includes(baselineEnglishHash);
	if (!codeChanged && !englishChanged) {
		return 'SYNCED';
	}
	if (codeChanged && !englishChanged) {
		return 'CODE_CHANGED';
	}
	if (!codeChanged) {
		return 'ENGLISH_CHANGED';
	}
	return 'BOTH_CHANGED';
}

export function renderFrontmatter(
	frontmatter: InterpretationFrontmatter,
	body: string,
): string {
	return [
		'---',
		'schemaVersion: 1',
		`source: ${JSON.stringify(frontmatter.source)}`,
		`sourceHash: ${JSON.stringify(frontmatter.sourceHash)}`,
		`editableEnglishHash: ${JSON.stringify(frontmatter.editableEnglishHash)}`,
		...(frontmatter.mappingRevisionHash
			? [`mappingRevisionHash: ${JSON.stringify(frontmatter.mappingRevisionHash)}`]
			: []),
		`languageId: ${JSON.stringify(frontmatter.languageId)}`,
		`promptVersion: ${JSON.stringify(frontmatter.promptVersion)}`,
		`model: ${JSON.stringify(frontmatter.model)}`,
		`interpretedAt: ${JSON.stringify(frontmatter.interpretedAt)}`,
		'---',
		body,
	].join('\n');
}

function parseFrontmatter(raw: string): Map<string, unknown> {
	const values = new Map<string, unknown>();
	for (const line of raw.split('\n')) {
		const separator = line.indexOf(':');
		if (separator <= 0) {
			throw new Error('The English document has malformed LangClarity frontmatter.');
		}
		const key = line.slice(0, separator).trim();
		if (!allowedFrontmatterKeys.has(key) || values.has(key)) {
			throw new Error(`The English document has an unsupported or duplicate frontmatter field: ${key}.`);
		}
		const rawValue = line.slice(separator + 1).trim();
		try {
			values.set(key, JSON.parse(rawValue));
		} catch {
			throw new Error(`The English document has an invalid frontmatter value for ${key}.`);
		}
	}
	return values;
}

function validateFrontmatter(values: Map<string, unknown>): InterpretationFrontmatter {
	const schemaVersion = values.get('schemaVersion');
	if (schemaVersion !== 1) {
		throw new Error('This English document uses an unsupported LangClarity schema version.');
	}
	const source = requiredString(values, 'source');
	if (source === '..' || source.startsWith('../') || source.startsWith('/')) {
		throw new Error('The English document contains an invalid source path.');
	}
	const sourceHash = requiredHash(values, 'sourceHash');
	const editableEnglishHash = requiredHash(values, 'editableEnglishHash');
	const mappingRevisionHash = optionalHash(values, 'mappingRevisionHash');
	const languageId = requiredString(values, 'languageId');
	if (!supportedLanguageIds.has(languageId)) {
		throw new Error('The English document contains an unsupported language ID.');
	}

	return {
		schemaVersion,
		source,
		sourceHash,
		editableEnglishHash,
		...(mappingRevisionHash ? { mappingRevisionHash } : {}),
		languageId,
		promptVersion: requiredString(values, 'promptVersion'),
		model: requiredString(values, 'model'),
		interpretedAt: requiredString(values, 'interpretedAt'),
	};
}

function requiredString(values: Map<string, unknown>, key: string): string {
	const value = values.get(key);
	if (typeof value !== 'string' || value.length === 0 || /[\r\n]/u.test(value)) {
		throw new Error(`The English document is missing a valid ${key} value.`);
	}
	return value;
}

function requiredHash(values: Map<string, unknown>, key: string): string {
	const value = requiredString(values, key);
	if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
		throw new Error(`The English document has an invalid ${key} value.`);
	}
	return value;
}

function optionalHash(values: Map<string, unknown>, key: string): string | undefined {
	if (!values.has(key)) {
		return undefined;
	}
	return requiredHash(values, key);
}

function validateBody(body: string): void {
	if ((body.match(/^# .+$/gmu) ?? []).length !== 1) {
		throw new Error('The English document is missing its source title.');
	}
	let previousIndex = -1;
	for (const heading of requiredHeadings) {
		const matches = body.match(new RegExp(`^${escapeRegExp(heading)}$`, 'gmu')) ?? [];
		const index = body.indexOf(heading);
		if (matches.length !== 1 || index <= previousIndex) {
			throw new Error(`The English document is missing or has moved the required heading: ${heading}.`);
		}
		previousIndex = index;
	}
	hashEditableBody(body);
}

function legacyEditableEnglishHash(body: string): string | undefined {
	try {
		const purpose = section(body, '## Purpose', '## Responsibilities').trim();
		const responsibilities = parseList(section(body, '## Responsibilities', '## Behavior'));
		const behaviorText = section(body, '## Behavior', generatedStart).trim();
		const sideEffects = parseList(section(body, '## Side effects', '## Constraints'));
		const constraints = parseList(body.slice(body.indexOf('## Constraints') + '## Constraints'.length));
		const behavior = behaviorText === '_None identified._'
			? []
			: behaviorText.split('\n').map((line) => {
				const match = line.match(/^\d+\. (.+) _\((\d+)–(\d+)(?:; symbol `(.+)`)?\)_$/u);
				if (!match) {
					throw new Error('not legacy behavior');
				}
				return {
					statement: unescapeMarkdown(match[1]),
					evidence: {
						startLine: Number(match[2]),
						endLine: Number(match[3]),
						symbolName: unescapeMarkdown(match[4] ?? ''),
					},
				};
			});
		return hashText(JSON.stringify({
			purpose: unescapeMarkdown(purpose),
			responsibilities,
			behavior,
			sideEffects,
			constraints,
		}));
	} catch {
		return undefined;
	}
}

function section(body: string, startHeading: string, endHeading: string): string {
	const startIndex = body.indexOf(startHeading);
	const endIndex = body.indexOf(endHeading, startIndex + startHeading.length);
	if (startIndex < 0 || endIndex < 0) {
		throw new Error('missing section');
	}
	return body.slice(startIndex + startHeading.length, endIndex).trim();
}

function parseList(value: string): string[] {
	const trimmed = value.trim();
	if (trimmed === '_None identified._') {
		return [];
	}
	return trimmed.split('\n').map((line) => {
		if (!line.startsWith('- ')) {
			throw new Error('not legacy list');
		}
		return unescapeMarkdown(line.slice(2));
	});
}

function normalizeNewlines(value: string): string {
	return value.replace(/\r\n|\r/gu, '\n');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
