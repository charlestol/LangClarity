export function parsePositiveInt(text: string): number | undefined {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const value = Number(trimmed);
	if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
		return undefined;
	}
	return value;
}
