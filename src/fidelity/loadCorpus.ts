import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
	FidelityClaimsFile,
	FidelityManifest,
	LoadedFidelityFixture,
} from './types';

export function corpusRootFromExtensionRoot(extensionRoot: string): string {
	return path.join(extensionRoot, 'benchmarks', 'fidelity');
}

export function loadFidelityManifest(corpusRoot: string): FidelityManifest {
	const raw = JSON.parse(readFileSync(path.join(corpusRoot, 'manifest.json'), 'utf8')) as FidelityManifest;
	if (!raw.corpusVersion || !Array.isArray(raw.fixtures) || raw.fixtures.length === 0) {
		throw new Error('Fidelity corpus manifest is missing fixtures.');
	}
	return raw;
}

export function loadFidelityFixtures(
	corpusRoot: string,
	options: { includeHeldOut?: boolean } = {},
): LoadedFidelityFixture[] {
	const includeHeldOut = options.includeHeldOut !== false;
	const manifest = loadFidelityManifest(corpusRoot);
	const heldOut = new Set(manifest.heldOutIds);
	return manifest.fixtures.flatMap((entry): LoadedFidelityFixture[] => {
		const isHeldOut = heldOut.has(entry.id);
		if (isHeldOut && !includeHeldOut) {
			return [];
		}
		const fixtureDir = path.join(corpusRoot, 'fixtures', entry.id);
		const claims = JSON.parse(
			readFileSync(path.join(fixtureDir, 'claims.json'), 'utf8'),
		) as FidelityClaimsFile;
		if (claims.id !== entry.id) {
			throw new Error(`Fixture ${entry.id} claims id mismatch: ${claims.id}`);
		}
		const source = readFileSync(path.join(fixtureDir, claims.sourceFile), 'utf8');
		return [{
			id: entry.id,
			tags: entry.tags,
			heldOut: isHeldOut,
			languageId: claims.languageId,
			sourcePath: path.posix.join('fixtures', entry.id, claims.sourceFile),
			sourceFileName: claims.sourceFile,
			source,
			claims,
		}];
	});
}
