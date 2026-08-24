import * as assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';

suite('Extension contributions', () => {
	test('exposes phase commands contextually and keeps interpretation internal', () => {
		const manifest = JSON.parse(
			readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
		) as {
			publisher?: string;
			license?: string;
			scripts?: Record<string, string>;
			activationEvents?: string[];
			capabilities?: { untrustedWorkspaces?: { supported?: boolean } };
			contributes?: {
				commands?: Array<{ command?: string }>;
				menus?: { commandPalette?: Array<{ command?: string; when?: string }> };
			};
		};
		const commands = manifest.contributes?.commands?.map((item) => item.command) ?? [];
		const hidden = manifest.contributes?.menus?.commandPalette ?? [];

		assert.ok(commands.includes('langclarity.openEnglishView'));
		assert.ok(commands.includes('langclarity.interpretFile'));
		assert.ok(commands.includes('langclarity.englishToCode'));
		assert.ok(commands.includes('langclarity.codeToEnglish'));
		assert.ok(commands.includes('langclarity.selectModel'));
		assert.ok(!commands.includes('langclarity.helloWorld'));
		assert.ok(hidden.some((item) => item.command === 'langclarity.openEnglishView'
			&& item.when?.includes('editorLangId == typescript')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.interpretFile' && item.when === 'false'));
		assert.ok(hidden.some((item) => item.command === 'langclarity.englishToCode'
			&& item.when === 'editorLangId == markdown'));
		assert.ok(hidden.some((item) => item.command === 'langclarity.codeToEnglish'
			&& item.when?.includes('editorLangId == markdown')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.selectModel'
			&& item.when?.includes('editorLangId == typescript')));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.englishToCode'));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.codeToEnglish'));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.selectModel'));
		assert.ok(manifest.activationEvents?.includes('workspaceContains:**/.langclarity/**/*.md'));
		assert.strictEqual(manifest.publisher, 'langclarity');
		assert.strictEqual(manifest.license, 'MIT');
		assert.strictEqual(manifest.capabilities?.untrustedWorkspaces?.supported, false);
		assert.strictEqual(manifest.scripts?.['package:vsix'], 'vsce package');
	});

	test('documents setup, privacy, supported languages, limits, and troubleshooting', () => {
		const readme = readFileSync(path.join(__dirname, '..', '..', 'README.md'), 'utf8');
		assert.match(readme, /\.ts.*\.tsx.*\.js.*\.jsx/u);
		assert.match(readme, /Codex 0\.148\.0-alpha\.15 or newer/u);
		assert.match(readme, /does not collect product telemetry/u);
		assert.match(readme, /75 KiB and 2,000 lines/u);
		assert.match(readme, /## Troubleshooting/u);
		assert.match(readme, /npm run package:vsix/u);
	});

	test('packages only the TypeScript compiler API needed at runtime', () => {
		const vscodeIgnore = readFileSync(path.join(__dirname, '..', '..', '.vscodeignore'), 'utf8');
		assert.match(vscodeIgnore, /^node_modules\/typescript\/bin\/\*\*$/mu);
		assert.match(vscodeIgnore, /^node_modules\/typescript\/lib\/_tsc\.js$/mu);
		assert.match(vscodeIgnore, /^node_modules\/typescript\/lib\/\*\/diagnosticMessages\.generated\.json$/mu);
		assert.doesNotMatch(vscodeIgnore, /^node_modules\/typescript\/lib\/typescript\.js$/mu);
	});
});
