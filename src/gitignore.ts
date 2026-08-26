const langClarityIgnoreRule = '/.langclarity/';

export function hasLangClarityIgnoreRule(content: string): boolean {
	let ignored = false;
	for (const line of content.split(/\r?\n/u)) {
		const rule = line.trim();
		if (/^(?:\*\*\/)?\/?\.langclarity\/?$/u.test(rule)) {
			ignored = true;
		} else if (/^!(?:\*\*\/)?\/?\.langclarity\/?$/u.test(rule)) {
			ignored = false;
		}
	}
	return ignored;
}

export function appendLangClarityIgnoreRule(content: string, endOfLine = '\n'): string {
	if (hasLangClarityIgnoreRule(content)) {
		return content;
	}
	const separator = content.length > 0 && !content.endsWith('\n') ? endOfLine : '';
	return `${content}${separator}${langClarityIgnoreRule}${endOfLine}`;
}
