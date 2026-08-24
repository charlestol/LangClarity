import * as assert from 'node:assert';
import * as vscode from 'vscode';
import {
	AuthenticationRequiredError,
	codexErrorFrom,
	CodexInterpreter,
	CodexResponseError,
	UsageLimitedError,
	validateCodeChangeResult,
	compareVersions,
	isForbiddenToolNotification,
	toolRestrictedAppServerArgs,
	toolRestrictedThreadPolicy,
} from '../codexInterpreter';
import {
	englishUriFor,
	hashText,
	lineCount,
	relativeSourcePath,
	renderInterpretation,
	validateInterpretation,
} from '../interpretation';

suite('Interpretation', () => {
	test('maps a source path without dropping its extension', () => {
		const workspace = vscode.Uri.file('/workspace');
		const source = vscode.Uri.file('/workspace/src/users.ts');

		assert.strictEqual(relativeSourcePath(workspace, source), 'src/users.ts');
		assert.strictEqual(
			englishUriFor(workspace, source).path,
			'/workspace/.langclarity/src/users.ts.md',
		);
	});

	test('rejects paths outside the workspace', () => {
		assert.throws(
			() => relativeSourcePath(vscode.Uri.file('/workspace'), vscode.Uri.file('/other/file.ts')),
			/inside the current workspace/u,
		);
	});

	test('validates evidence against the submitted source', () => {
		const valid = {
			purpose: 'Return a greeting.',
			responsibilities: ['Create a greeting.'],
			behavior: [{
				statement: 'Return the greeting.',
				evidence: { startLine: 1, endLine: 1, symbolName: 'greet' },
			}],
			sideEffects: [],
			constraints: [],
		};

		assert.deepStrictEqual(validateInterpretation(valid, 1), valid);
		assert.throws(
			() => validateInterpretation({
				...valid,
				behavior: [{
					statement: 'Invented behavior.',
					evidence: { startLine: 1, endLine: 2, symbolName: '' },
				}],
			}, 1),
			/invalid source evidence/u,
		);
		assert.throws(
			() => validateInterpretation({ ...valid, unsupported: true }, 1),
			/invalid interpretation/u,
		);
	});

	test('renders versioned Markdown and escapes model-controlled links', () => {
		const markdown = renderInterpretation({
			result: {
				purpose: 'Describe [unsafe](command:run).',
				responsibilities: [],
				behavior: [],
				sideEffects: [],
				constraints: [],
			},
			sourcePath: 'src/example.ts',
			sourceHash: hashText('export {};'),
			languageId: 'typescript',
			model: 'runtime-default',
			interpretedAt: '2026-08-22T00:00:00.000Z',
		});

		assert.match(markdown, /schemaVersion: 1/u);
		assert.match(markdown, /editableEnglishHash: "sha256:/u);
		assert.ok(markdown.includes('Describe \\[unsafe\\](command:run).'));
		assert.match(markdown, /langclarity:generated:start relationships/u);
	});

	test('hashes exact text and counts common newline forms', () => {
		assert.notStrictEqual(hashText('value'), hashText('value '));
		assert.strictEqual(lineCount('one\r\ntwo\rthree'), 3);
	});

	test('compares the provisional minimum Codex version', () => {
		assert.strictEqual(compareVersions('0.148.0-alpha.15', '0.148.0-alpha.15'), 0);
		assert.strictEqual(compareVersions('0.148.0', '0.148.0-alpha.15'), 1);
		assert.strictEqual(compareVersions('0.148.1', '0.148.0-alpha.15'), 1);
		assert.strictEqual(compareVersions('0.147.9', '0.148.0-alpha.15'), -1);
	});

	test('starts Codex with runtime-enforced tool restrictions', () => {
		const args = toolRestrictedAppServerArgs();
		assert.deepStrictEqual(args.slice(0, 2), ['app-server', '--stdio']);
		assert.ok(args.includes('web_search="disabled"'));
		assert.ok(args.includes('mcp_servers={}'));
		for (const feature of ['apps', 'plugins', 'shell_tool', 'unified_exec', 'view_image']) {
			const index = args.indexOf(feature);
			assert.ok(index > 0);
			assert.strictEqual(args[index - 1], '--disable');
		}
	});

	test('roots inference outside the user workspace and rejects tool items', () => {
		const policy = toolRestrictedThreadPolicy('/tmp/langclarity-isolated');
		assert.deepStrictEqual(policy.cwd, '/tmp/langclarity-isolated');
		assert.deepStrictEqual(policy.runtimeWorkspaceRoots, ['/tmp/langclarity-isolated']);
		assert.deepStrictEqual((policy.config as Record<string, unknown>).mcp_servers, {});
		assert.strictEqual(
			((policy.config as { features: Record<string, boolean> }).features).shell_tool,
			false,
		);
		assert.strictEqual(isForbiddenToolNotification({
			method: 'item/started',
			params: { item: { type: 'commandExecution' } },
		}), true);
		assert.strictEqual(isForbiddenToolNotification({
			method: 'item/completed',
			params: { item: { type: 'agentMessage' } },
		}), false);
	});

	test('validates complete English-to-code proposals', () => {
		const proposal = {
			proposedSource: 'export const value = 2;\n',
			summary: 'Updates the exported value.',
		};
		assert.deepStrictEqual(validateCodeChangeResult(proposal), proposal);
		assert.throws(
			() => validateCodeChangeResult({ ...proposal, unsupported: true }),
			/invalid code proposal/u,
		);
		assert.throws(
			() => validateCodeChangeResult({ ...proposal, summary: 'line one\nline two' }),
			/invalid code proposal/u,
		);
	});

	test('classifies structured Codex failures without changing their messages', () => {
		const usage = codexErrorFrom({
			message: 'Usage is exhausted for this account.',
			codexErrorInfo: 'usageLimitExceeded',
		});
		assert.ok(usage instanceof UsageLimitedError);
		assert.strictEqual(usage.message, 'Usage is exhausted for this account.');

		const authentication = codexErrorFrom({
			message: 'Authentication expired.',
			codexErrorInfo: 'unauthorized',
		});
		assert.ok(authentication instanceof AuthenticationRequiredError);

		const provider = codexErrorFrom({ message: 'Provider failed.', codexErrorInfo: 'other' }, true);
		assert.ok(provider instanceof CodexResponseError);
		assert.strictEqual(provider.message, 'Provider failed.');
		assert.strictEqual(provider.willRetry, true);
	});

	test('rejects over-limit requests before starting Codex', async () => {
		const cancellation = new vscode.CancellationTokenSource();
		try {
			await assert.rejects(
				new CodexInterpreter().codeToEnglish({
					source: 'x'.repeat(75 * 1024 + 1),
					sourcePath: 'large.ts',
					languageId: 'typescript',
					workspacePath: '/workspace',
					cancellationToken: cancellation.token,
				}),
				/75 KiB/u,
			);
			await assert.rejects(
				new CodexInterpreter().englishToCode({
					source: 'export {};',
					english: 'x'.repeat(256 * 1024 + 1),
					sourcePath: 'example.ts',
					languageId: 'typescript',
					workspacePath: '/workspace',
					cancellationToken: cancellation.token,
				}),
				/256 KiB/u,
			);
		} finally {
			cancellation.dispose();
		}
	});
});
