export function uniquePairs(values: number[]): Array<[number, number]> {
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i < values.length; i += 1) {
		for (let j = i + 1; j < values.length; j += 1) {
			if (values[i] !== values[j]) {
				pairs.push([values[i], values[j]]);
			}
		}
	}
	return pairs;
}
