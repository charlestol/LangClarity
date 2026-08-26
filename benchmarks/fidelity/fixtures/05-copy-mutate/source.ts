export function markActive(ids: string[]): string[] {
	const copy = [...ids];
	copy.push('active');
	return copy;
}
