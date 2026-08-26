import type {
	CodeToEnglishInput,
	CodeToEnglishOutput,
	EnglishToCodeInput,
	EnglishToCodeOutput,
} from './codexInterpreter';

/** Thin seam over Codex (or a test fake) for the two MVP sync operations. */
export interface Interpreter {
	codeToEnglish(input: CodeToEnglishInput): Promise<CodeToEnglishOutput>;
	englishToCode(input: EnglishToCodeInput): Promise<EnglishToCodeOutput>;
}
