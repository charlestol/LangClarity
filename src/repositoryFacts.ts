import path from 'node:path';
import * as vscode from 'vscode';
import type * as TypeScript from 'typescript';

let typescriptPromise: Promise<typeof TypeScript> | undefined;

/** Process-lifetime cache of compiler options by tsconfig path. No file watchers; stale until reload. */
const compilerOptionsByConfigPath = new Map<string, TypeScript.CompilerOptions>();

export interface SourceImport {
	specifier: string;
	line: number;
}

export interface SourceStructure {
	keyDefinitions: string[];
	imports: SourceImport[];
}

export interface RepositoryFacts {
	keyDefinitions: string[];
	dependencies: string[];
	relatedFiles: string[];
	relatedTests: string[];
}

export async function sourceStructure(source: string, sourcePath: string): Promise<SourceStructure> {
	const ts = await loadTypeScript();
	const sourceFile = ts.createSourceFile(
		path.posix.basename(sourcePath),
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind(ts, sourcePath),
	);
	const keyDefinitions: string[] = [];
	const imports: SourceImport[] = [];

	for (const statement of sourceFile.statements) {
		const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
		for (const definition of definitionNames(ts, statement)) {
			keyDefinitions.push(`${definition} (line ${line})`);
		}
		const moduleSpecifier = moduleSpecifierFor(ts, statement);
		if (moduleSpecifier) {
			imports.push({ specifier: moduleSpecifier, line });
		}
	}

	return { keyDefinitions, imports };
}

export async function repositoryFactsFor(
	source: string,
	sourceUri: vscode.Uri,
	workspaceUri: vscode.Uri,
): Promise<RepositoryFacts> {
	const ts = await loadTypeScript();
	const structure = await sourceStructure(source, sourceUri.path);
	const compilerOptions = compilerOptionsFor(ts, sourceUri.fsPath);
	const dependencies: string[] = [];
	const relatedFiles = new Set<string>();

	for (const imported of structure.imports) {
		const resolved = ts.resolveModuleName(
			imported.specifier,
			sourceUri.fsPath,
			compilerOptions,
			ts.sys,
		).resolvedModule?.resolvedFileName;
		const relative = resolved ? workspaceRelativePath(workspaceUri.fsPath, resolved) : undefined;
		if (relative && !relative.split('/').includes('node_modules')) {
			dependencies.push(`${imported.specifier} → ${relative} (line ${imported.line})`);
			relatedFiles.add(relative);
		} else {
			dependencies.push(`${imported.specifier} (external or unresolved, line ${imported.line})`);
		}
	}

	return {
		keyDefinitions: structure.keyDefinitions,
		dependencies,
		relatedFiles: [...relatedFiles].map((file) => `${file} (directly imported)`),
		relatedTests: [],
	};
}

function definitionNames(
	ts: typeof TypeScript,
	statement: TypeScript.Statement,
): string[] {
	if (ts.isFunctionDeclaration(statement) && statement.name) {
		return [`Function ${statement.name.text}`];
	}
	if (ts.isClassDeclaration(statement) && statement.name) {
		return [`Class ${statement.name.text}`];
	}
	if (ts.isInterfaceDeclaration(statement)) {
		return [`Interface ${statement.name.text}`];
	}
	if (ts.isTypeAliasDeclaration(statement)) {
		return [`Type ${statement.name.text}`];
	}
	if (ts.isEnumDeclaration(statement)) {
		return [`Enum ${statement.name.text}`];
	}
	if (ts.isVariableStatement(statement)) {
		return statement.declarationList.declarations.flatMap((declaration) => {
			return ts.isIdentifier(declaration.name) ? [`Variable ${declaration.name.text}`] : [];
		});
	}
	return [];
}

function moduleSpecifierFor(
	ts: typeof TypeScript,
	statement: TypeScript.Statement,
): string | undefined {
	if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
		&& statement.moduleSpecifier
		&& ts.isStringLiteral(statement.moduleSpecifier)) {
		return statement.moduleSpecifier.text;
	}
	if (ts.isImportEqualsDeclaration(statement)
		&& ts.isExternalModuleReference(statement.moduleReference)
		&& statement.moduleReference.expression
		&& ts.isStringLiteral(statement.moduleReference.expression)) {
		return statement.moduleReference.expression.text;
	}
	return undefined;
}

function compilerOptionsFor(
	ts: typeof TypeScript,
	sourcePath: string,
): TypeScript.CompilerOptions {
	const configPath = ts.findConfigFile(path.dirname(sourcePath), ts.sys.fileExists);
	if (!configPath) {
		return defaultCompilerOptions(ts);
	}

	const cached = compilerOptionsByConfigPath.get(configPath);
	if (cached) {
		return cached;
	}

	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	if (config.error) {
		return defaultCompilerOptions(ts);
	}

	// convertCompilerOptionsFromJson reads options only — unlike parseJsonConfigFileContent,
	// it does not enumerate include/exclude via ts.sys.readDirectory.
	const { options } = ts.convertCompilerOptionsFromJson(
		config.config.compilerOptions ?? {},
		path.dirname(configPath),
		configPath,
	);
	compilerOptionsByConfigPath.set(configPath, options);
	return options;
}

function defaultCompilerOptions(ts: typeof TypeScript): TypeScript.CompilerOptions {
	return {
		allowJs: true,
		jsx: ts.JsxEmit.Preserve,
		module: ts.ModuleKind.Node16,
		moduleResolution: ts.ModuleResolutionKind.Node16,
	};
}

function workspaceRelativePath(workspacePath: string, filePath: string): string | undefined {
	const relative = path.relative(workspacePath, filePath);
	if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative.split(path.sep).join('/');
}

function loadTypeScript(): Promise<typeof TypeScript> {
	typescriptPromise ??= import('typescript');
	return typescriptPromise;
}

function scriptKind(ts: typeof TypeScript, filePath: string): TypeScript.ScriptKind {
	switch (path.posix.extname(filePath).toLowerCase()) {
		case '.ts': return ts.ScriptKind.TS;
		case '.tsx': return ts.ScriptKind.TSX;
		case '.js': return ts.ScriptKind.JS;
		case '.jsx': return ts.ScriptKind.JSX;
		default: return ts.ScriptKind.Unknown;
	}
}
