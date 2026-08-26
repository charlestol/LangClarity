export function escapeMarkdown(value: string): string {
	return value
		.replaceAll('\\', '\\\\')
		.replaceAll('&', '&amp;')
		.replaceAll('`', '\\`')
		.replaceAll('[', '\\[')
		.replaceAll(']', '\\]')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

export function unescapeMarkdown(value: string): string {
	return value
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&')
		.replace(/\\([\\`\[\]])/gu, '$1');
}
