export interface FidelityClaim {
	id: string;
	description: string;
	/** Each pattern is a JavaScript RegExp source. All patterns in the claim must match (AND). */
	patterns: string[];
}

export interface FidelityClaimsFile {
	id: string;
	languageId: string;
	sourceFile: string;
	notes?: string;
	mustHave: FidelityClaim[];
	prohibited: FidelityClaim[];
}

export interface FidelityManifestFixture {
	id: string;
	tags: string[];
}

export interface FidelityManifest {
	corpusVersion: string;
	promptVersionExpected: string;
	description: string;
	heldOutIds: string[];
	fixtures: FidelityManifestFixture[];
}

export interface LoadedFidelityFixture {
	id: string;
	tags: string[];
	heldOut: boolean;
	languageId: string;
	sourcePath: string;
	sourceFileName: string;
	source: string;
	claims: FidelityClaimsFile;
}

export type ClaimOutcome = 'pass' | 'fail';

export interface ScoredClaim {
	id: string;
	kind: 'mustHave' | 'prohibited';
	description: string;
	outcome: ClaimOutcome;
	missingPatterns?: string[];
	matchedPatterns?: string[];
}

export interface FidelityScore {
	fixtureId: string;
	lineParity: boolean;
	behaviorLineCount: number;
	sourceLineCount: number;
	mustHave: ScoredClaim[];
	prohibited: ScoredClaim[];
	mustHavePassed: number;
	mustHaveTotal: number;
	prohibitedPassed: number;
	prohibitedTotal: number;
	/** True when line parity holds, every must-have passes, and every prohibited passes. */
	deterministicPass: boolean;
}
