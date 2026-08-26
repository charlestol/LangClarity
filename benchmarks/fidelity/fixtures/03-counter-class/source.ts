export class Counter {
	private value = 0;

	increment(): number {
		this.value += 1;
		return this.value;
	}

	reset(): void {
		this.value = 0;
	}
}
