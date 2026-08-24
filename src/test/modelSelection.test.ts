import * as assert from 'node:assert';
import { resolveCodexModel, visibleCodexModels } from '../modelSelection';

suite('Model selection', () => {
	test('shows only valid visible runtime models', () => {
		assert.deepStrictEqual(visibleCodexModels({ data: [
			{
				id: 'default-model',
				displayName: 'Default Model',
				isDefault: true,
				hidden: false,
				defaultReasoningEffort: 'low',
				supportedReasoningEfforts: [
					{ reasoningEffort: 'low' },
					{ reasoningEffort: 'medium' },
				],
			},
			{ id: 'hidden-model', hidden: true },
			{ displayName: 'Missing ID', hidden: false },
		] }), [{
			id: 'default-model',
			displayName: 'Default Model',
			isDefault: true,
			defaultReasoningEffort: 'low',
			supportedReasoningEfforts: ['low', 'medium'],
		}]);
	});

	test('honors available preferences and recommends medium for interpretation', () => {
		const models = visibleCodexModels({ data: [
			{
				id: 'default-model',
				isDefault: true,
				defaultReasoningEffort: 'low',
				supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }],
			},
			{
				id: 'alternate-model',
				defaultReasoningEffort: 'high',
				supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
			},
		] });

		assert.deepStrictEqual(resolveCodexModel(models, {}, true), {
			model: models[0],
			reasoningEffort: 'medium',
		});
		assert.deepStrictEqual(resolveCodexModel(models, {
			modelId: 'alternate-model',
			reasoningEffort: 'high',
		}, true), {
			model: models[1],
			reasoningEffort: 'high',
		});
	});

	test('falls back to the runtime default when a saved model disappears', () => {
		const models = visibleCodexModels({ data: [{
			id: 'runtime-default',
			isDefault: true,
			defaultReasoningEffort: 'low',
			supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
		}] });
		assert.deepStrictEqual(resolveCodexModel(models, { modelId: 'retired-model' }, true), {
			model: models[0],
			reasoningEffort: 'low',
			unavailableModelId: 'retired-model',
		});
	});
});
