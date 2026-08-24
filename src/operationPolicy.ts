const MAX_CONCURRENT_OPERATIONS = 2;

export function operationStartError(
	activeSourceKeys: ReadonlySet<string>,
	sourceKey: string,
): string | undefined {
	if (activeSourceKeys.has(sourceKey)) {
		return 'LangClarity is already synchronizing this file.';
	}
	if (activeSourceKeys.size >= MAX_CONCURRENT_OPERATIONS) {
		return 'LangClarity MVP runs at most two Codex operations at once.';
	}
	return undefined;
}
