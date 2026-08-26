import { isRecord } from './typeGuards';

export interface CodexModel {
	id: string;
	displayName: string;
	isDefault: boolean;
	defaultReasoningEffort?: string;
	supportedReasoningEfforts: string[];
}

export interface CodexModelPreference {
	modelId?: string;
	reasoningEffort?: string;
}

export interface ResolvedCodexModel {
	model: CodexModel;
	reasoningEffort?: string;
	unavailableModelId?: string;
}

export function visibleCodexModels(value: unknown): CodexModel[] {
	if (!isRecord(value) || !Array.isArray(value.data)) {
		return [];
	}
	return value.data.flatMap((candidate): CodexModel[] => {
		if (!isRecord(candidate)
			|| candidate.hidden === true
			|| typeof candidate.id !== 'string'
			|| candidate.id.length === 0) {
			return [];
		}
		const efforts = Array.isArray(candidate.supportedReasoningEfforts)
			? candidate.supportedReasoningEfforts.flatMap((option): string[] => {
				return isRecord(option) && typeof option.reasoningEffort === 'string'
					? [option.reasoningEffort]
					: [];
			})
			: [];
		return [{
			id: candidate.id,
			displayName: typeof candidate.displayName === 'string' && candidate.displayName.length > 0
				? candidate.displayName
				: candidate.id,
			isDefault: candidate.isDefault === true,
			...(typeof candidate.defaultReasoningEffort === 'string'
				? { defaultReasoningEffort: candidate.defaultReasoningEffort }
				: {}),
			supportedReasoningEfforts: [...new Set(efforts)],
		}];
	});
}

export function resolveCodexModel(
	models: CodexModel[],
	preference: CodexModelPreference,
	preferMedium: boolean,
): ResolvedCodexModel {
	const runtimeDefault = models.find((model) => model.isDefault) ?? models[0];
	if (!runtimeDefault) {
		throw new Error('Codex returned no available models.');
	}
	const preferred = preference.modelId
		? models.find((model) => model.id === preference.modelId)
		: undefined;
	const model = preferred ?? runtimeDefault;
	const supported = new Set(model.supportedReasoningEfforts);
	const reasoningEffort = preference.reasoningEffort && supported.has(preference.reasoningEffort)
		? preference.reasoningEffort
		: preferMedium && supported.has('medium')
			? 'medium'
			: model.defaultReasoningEffort;
	return {
		model,
		...(reasoningEffort ? { reasoningEffort } : {}),
		...(preference.modelId && !preferred ? { unavailableModelId: preference.modelId } : {}),
	};
}
