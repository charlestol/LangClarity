import * as assert from 'node:assert';
import { operationStartError } from '../operationPolicy';

suite('Operation policy', () => {
	test('allows two unrelated operations and rejects duplicate or excess work', () => {
		assert.strictEqual(operationStartError(new Set(), 'first'), undefined);
		assert.match(operationStartError(new Set(['first']), 'first') ?? '', /already synchronizing/u);
		assert.strictEqual(operationStartError(new Set(['first']), 'second'), undefined);
		assert.match(
			operationStartError(new Set(['first', 'second']), 'third') ?? '',
			/at most two/u,
		);
	});
});
