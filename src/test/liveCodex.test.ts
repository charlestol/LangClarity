import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { CodexInterpreter } from '../codexInterpreter';
import { hashText, renderInterpretation } from '../interpretation';

suite('Live Codex smoke test', () => {
	test('interprets and proposes code without changing the fixture', async function () {
		if (process.env.LANGCLARITY_LIVE_TEST !== '1') {
			this.skip();
		}
		this.timeout(360_000);
		const workspacePath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'liveCodex');
		const sourcePath = path.join(workspacePath, 'src', 'userService.ts');
		const before = readFileSync(sourcePath, 'utf8');
		const changedSource = before.replace('limit = 10', 'limit = 5');
		assert.notStrictEqual(changedSource, before);
		const cancellation = new vscode.CancellationTokenSource();

		try {
			const interpreter = new CodexInterpreter();
			const models = await interpreter.listModels(workspacePath);
			assert.ok(models.length > 0);
			assert.ok(models.every((model) => model.id.length > 0));
			const result = await interpreter.codeToEnglish({
				source: changedSource,
				sourcePath: 'src/userService.ts',
				languageId: 'typescript',
				workspacePath,
				cancellationToken: cancellation.token,
				modelPreference: { modelId: 'langclarity-unavailable-model' },
			});
			assert.strictEqual(result.unavailableModelId, 'langclarity-unavailable-model');
			assert.strictEqual(result.model, (models.find((model) => model.isDefault) ?? models[0]).id);
			assert.ok(result.document.purpose.length > 0);
			assert.ok(result.document.behavior.length > 0);
			const english = renderInterpretation({
				result: result.document,
				sourcePath: 'src/userService.ts',
				sourceHash: hashText(changedSource),
				languageId: 'typescript',
				model: result.model,
				interpretedAt: new Date().toISOString(),
			}).replace('## Constraints\n', '## Constraints\n\n- The default user limit is 5.\n');
			const proposal = await interpreter.englishToCode({
				source: before,
				english,
				sourcePath: 'src/userService.ts',
				languageId: 'typescript',
				workspacePath,
				cancellationToken: cancellation.token,
				modelPreference: { modelId: result.model },
			});
			assert.match(proposal.proposedSource, /limit = 5/u);
			assert.strictEqual(hashText(readFileSync(sourcePath, 'utf8')), hashText(before));
		} finally {
			cancellation.dispose();
		}
	});
});
