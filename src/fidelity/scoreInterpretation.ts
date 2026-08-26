import { lineCount, type InterpretationResult } from '../interpretation';
import type { FidelityClaim, FidelityScore, ScoredClaim } from './types';

export function interpretationSearchText(document: InterpretationResult): string {
	return [
		document.purpose,
		...document.responsibilities,
		...document.behavior.map((item) => item.statement),
		...document.sideEffects,
		...document.constraints,
	].join('\n');
}

function compilePatterns(patterns: string[]): RegExp[] {
	return patterns.map((pattern) => {
		const caseInsensitive = pattern.startsWith('(?i)');
		const source = caseInsensitive ? pattern.slice('(?i)'.length) : pattern;
		return new RegExp(source, caseInsensitive ? 'iu' : 'u');
	});
}

function scoreMustHave(claim: FidelityClaim, text: string): ScoredClaim {
	const compiled = compilePatterns(claim.patterns);
	const missingPatterns = claim.patterns.filter((_pattern, index) => !compiled[index].test(text));
	return {
		id: claim.id,
		kind: 'mustHave',
		description: claim.description,
		outcome: missingPatterns.length === 0 ? 'pass' : 'fail',
		...(missingPatterns.length > 0 ? { missingPatterns } : {}),
	};
}

function scoreProhibited(claim: FidelityClaim, text: string): ScoredClaim {
	const compiled = compilePatterns(claim.patterns);
	const matchedPatterns = claim.patterns.filter((_pattern, index) => compiled[index].test(text));
	return {
		id: claim.id,
		kind: 'prohibited',
		description: claim.description,
		outcome: matchedPatterns.length === 0 ? 'pass' : 'fail',
		...(matchedPatterns.length > 0 ? { matchedPatterns } : {}),
	};
}

export function scoreInterpretation(
	fixtureId: string,
	source: string,
	document: InterpretationResult,
	claims: { mustHave: FidelityClaim[]; prohibited: FidelityClaim[] },
): FidelityScore {
	const text = interpretationSearchText(document);
	const sourceLineCount = lineCount(source);
	const behaviorLineCount = document.behavior.length;
	const lineParity = behaviorLineCount === sourceLineCount
		&& document.behavior.every((item, index) => item.sourceLine === index + 1);
	const mustHave = claims.mustHave.map((claim) => scoreMustHave(claim, text));
	const prohibited = claims.prohibited.map((claim) => scoreProhibited(claim, text));
	const mustHavePassed = mustHave.filter((claim) => claim.outcome === 'pass').length;
	const prohibitedPassed = prohibited.filter((claim) => claim.outcome === 'pass').length;
	return {
		fixtureId,
		lineParity,
		behaviorLineCount,
		sourceLineCount,
		mustHave,
		prohibited,
		mustHavePassed,
		mustHaveTotal: mustHave.length,
		prohibitedPassed,
		prohibitedTotal: prohibited.length,
		deterministicPass: lineParity
			&& mustHavePassed === mustHave.length
			&& prohibitedPassed === prohibited.length,
	};
}
