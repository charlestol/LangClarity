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
				customEditors?: Array<{ viewType?: string; selector?: Array<{ filenamePattern?: string }> }>;
				submenus?: Array<{ id?: string }>;
				menus?: {
					commandPalette?: Array<{ command?: string; when?: string }>;
					'editor/context'?: Array<{ submenu?: string; when?: string }>;
					'explorer/context'?: Array<{ submenu?: string; when?: string }>;
					'langclarity.sourceActions'?: Array<{ command?: string; when?: string }>;
					'langclarity.explorerSourceActions'?: Array<{ command?: string; when?: string }>;
				};
			};
		};
		const commands = manifest.contributes?.commands?.map((item) => item.command) ?? [];
		const hidden = manifest.contributes?.menus?.commandPalette ?? [];

		assert.ok(commands.includes('langclarity.openEnglishView'));
		assert.ok(commands.includes('langclarity.interpretFile'));
		assert.ok(commands.includes('langclarity.englishToCode'));
		assert.ok(commands.includes('langclarity.codeToEnglish'));
		assert.ok(commands.includes('langclarity.selectModel'));
		assert.ok(commands.includes('langclarity.openMarkdown'));
		assert.ok(commands.includes('langclarity.addToGitignore'));
		assert.ok(!commands.includes('langclarity.helloWorld'));
		assert.ok(hidden.some((item) => item.command === 'langclarity.openEnglishView'
			&& item.when?.includes('langclarity.activeHasInterpretation')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.interpretFile'
			&& item.when?.includes('!langclarity.activeHasInterpretation')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.englishToCode'
			&& item.when?.includes('activeCustomEditorId == langclarity.interpretationView')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.codeToEnglish'
			&& item.when?.includes('langclarity.activeHasInterpretation')));
		assert.ok(hidden.some((item) => item.command === 'langclarity.selectModel'
			&& item.when?.includes('editorLangId == typescript')));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.englishToCode'));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.codeToEnglish'));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.selectModel'));
		assert.ok(manifest.activationEvents?.includes('onCommand:langclarity.addToGitignore'));
		assert.ok(manifest.activationEvents?.includes('onCustomEditor:langclarity.interpretationView'));
		assert.ok(manifest.activationEvents?.includes('workspaceContains:**/.langclarity/**/*.md'));
		assert.ok(manifest.contributes?.customEditors?.some((item) => item.viewType === 'langclarity.interpretationView'
			&& item.selector?.some((selector) => selector.filenamePattern === '**/.langclarity/**/*.md')));
		assert.ok(manifest.contributes?.submenus?.some((item) => item.id === 'langclarity.sourceActions'));
		assert.ok(manifest.contributes?.submenus?.some((item) => item.id === 'langclarity.explorerSourceActions'));
		assert.ok(manifest.contributes?.menus?.['editor/context']?.some((item) => item.submenu === 'langclarity.sourceActions'
			&& item.when?.includes('editorLangId == typescript')));
		assert.ok(manifest.contributes?.menus?.['explorer/context']?.some((item) => item.submenu === 'langclarity.explorerSourceActions'
			&& item.when?.includes('resourceExtname == .ts')));
		assert.deepStrictEqual(
			manifest.contributes?.menus?.['langclarity.sourceActions']?.map((item) => item.command),
			[
				'langclarity.openEnglishView',
				'langclarity.interpretFile',
				'langclarity.codeToEnglish',
				'langclarity.englishToCode',
				'langclarity.selectModel',
			],
		);
		const sourceActions = manifest.contributes?.menus?.['langclarity.sourceActions'] ?? [];
		assert.ok(sourceActions.some((item) => item.command === 'langclarity.openEnglishView'
			&& item.when === 'langclarity.activeHasInterpretation'));
		assert.ok(sourceActions.some((item) => item.command === 'langclarity.interpretFile'
			&& item.when === '!langclarity.activeHasInterpretation'));
		assert.ok(sourceActions.some((item) => item.command === 'langclarity.englishToCode'
			&& item.when === 'langclarity.activeHasInterpretation'));
		const explorerActions = manifest.contributes?.menus?.['langclarity.explorerSourceActions'] ?? [];
		assert.ok(explorerActions.some((item) => item.command === 'langclarity.openEnglishView'
			&& item.when === 'resourcePath in langclarity.interpretedSourcePaths'));
		assert.ok(explorerActions.some((item) => item.command === 'langclarity.interpretFile'
			&& item.when === '!(resourcePath in langclarity.interpretedSourcePaths)'));
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

	test('uses one English Code textarea with a complete source-line gutter', () => {
		const provider = readFileSync(
			path.join(__dirname, '..', 'interpretationViewProvider.js'),
			'utf8',
		);
		const script = readFileSync(
			path.join(__dirname, '..', '..', 'media', 'interpretationView.js'),
			'utf8',
		);
		const stylesheet = readFileSync(
			path.join(__dirname, '..', '..', 'media', 'interpretationView.css'),
			'utf8',
		);

		assert.match(provider, /asWebviewUri/u);
		assert.match(provider, /localResourceRoots/u);
		assert.match(provider, /interpretationView\.js/u);
		assert.match(provider, /PANE_SYNC_DEBOUNCE_MS/u);
		assert.match(provider, /paneBehaviorSectionEdit/u);
		assert.match(provider, /<link rel="stylesheet"/u);
		assert.match(provider, /<script nonce="\$\{nonce\}" src="\$\{scriptUri\}"><\/script>/u);
		assert.doesNotMatch(provider, /<style>/u);
		assert.doesNotMatch(provider, /unsafe-inline/u);
		assert.doesNotMatch(provider, /function exactRow/u);
		assert.match(provider, /id="behavior-gutter"/u);
		assert.match(provider, /<textarea id="behavior-text"/u);
		assert.match(provider, /rows="1"/u);
		assert.match(provider, /id="cursor-position"/u);
		assert.match(provider, /id="suggested-action"/u);
		assert.match(provider, /id="repository-context-status"/u);
		assert.match(provider, /id="refresh-repository-context"/u);
		assert.match(provider, /refreshRepositoryFacts/u);
		assert.match(provider, /mappingRevisionHash/u);
		assert.match(provider, /data-tab="behavior">English Code</u);
		assert.doesNotMatch(provider, /<h2>English Code<\/h2>/u);
		assert.doesNotMatch(provider, /data-command="langclarity\.englishToCode"/u);
		assert.doesNotMatch(provider, /data-command="langclarity\.codeToEnglish"/u);
		assert.doesNotMatch(provider, /id="behavior-items"/u);
		assert.doesNotMatch(provider, /id="add"/u);
		assert.match(script, /gutter\.replaceChildren\(fragment\)/u);
		assert.match(script, /activeGutterIndex/u);
		assert.match(script, /function behaviorPayload\(\) \{ return behavior\.map\(\(item\) => item\.statement\); \}/u);
		assert.match(script, /function syncEditorRows/u);
		assert.match(script, /\.rows = Math\.max\(1, behavior\.length\)/u);
		assert.doesNotMatch(script, /\.style\./u);
		assert.doesNotMatch(script, /gutter'\)\.scrollTop/u);
		assert.match(script, /sourceLineCount/u);
		assert.doesNotMatch(script, /Everyday English, exactly one row per source line/u);
		assert.match(script, /function exactRow/u);
		assert.doesNotMatch(script, /event\.key === 'Enter'/u);
		assert.match(script, /event\.key !== 'Tab'/u);
		assert.match(script, /line\.addEventListener\('click'/u);
		assert.match(script, /Review & Apply English → Code/u);
		assert.match(script, /Apply Code → English/u);
		assert.match(script, /Choose Apply Direction/u);
		assert.match(script, /message\.type === 'documentSaved'/u);
		assert.match(script, /Repository context: Out of date/u);
		assert.match(script, /refreshRepositoryContext/u);
		assert.match(stylesheet, /overflow-y: hidden/u);
		assert.match(stylesheet, /main \{ padding: 20px 0 48px; \}/u);
		assert.match(stylesheet, /\.panel \{ box-sizing: border-box; display: none; width: 100%; \}/u);
		assert.doesNotMatch(stylesheet, /#overview, #structure, #effects/u);
		assert.doesNotMatch(stylesheet, /main \{ max-width: 920px/u);
		assert.doesNotMatch(stylesheet, /height: min\(58vh, 620px\)/u);
		assert.match(stylesheet, /repository-context-status\[data-state="STALE"\]/u);
	});

	test('requests exact source-aligned everyday English from Codex', () => {
		const interpreter = readFileSync(path.join(__dirname, '..', 'codexInterpreter.js'), 'utf8');

		assert.match(interpreter, /everyday person can understand/u);
		assert.match(interpreter, /one item for every numbered source line/u);
		assert.match(interpreter, /shortest clear wording/u);
		assert.match(interpreter, /opening or parent row establish context/u);
		assert.match(interpreter, /Readable fragments are allowed/u);
		assert.match(interpreter, /explain every element or property on its own row/u);
		assert.match(interpreter, /line containing only structural punctuation/u);
		assert.match(interpreter, /known value verbatim/u);
		assert.match(interpreter, /Avoid unexplained technical terms/u);
		assert.match(interpreter, /Do not use uppercase pseudocode keywords/u);
		assert.match(interpreter, /two-space indentation/u);
		assert.match(interpreter, /vague summaries/u);
	});
});
