export async function loadTitle(url: string): Promise<string> {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Request failed with ${response.status}`);
		}
		const data = await response.json() as { title?: string };
		return data.title ?? '';
	} catch (error) {
		console.error('loadTitle failed', error);
		return '';
	}
}
