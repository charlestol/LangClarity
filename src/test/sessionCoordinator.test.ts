import * as assert from 'node:assert';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as vscode from 'vscode';
import { SessionCoordinator } from '../sessionCoordinator';

suite('Session coordinator', () => {
	test('coalesces event refreshes and keeps reload immediate', async () => {
		const output = vscode.window.createOutputChannel('LangClarity session test');
		const coordinator = new SessionCoordinator(output);
		const sourceUri = vscode.Uri.file(path.join(tmpdir(), 'langclarity-missing-source.ts'));
		const englishUri = vscode.Uri.file(path.join(tmpdir(), 'langclarity-missing-english.md'));

		try {
			await coordinator.load(sourceUri, englishUri);
			const internals = coordinator as unknown as {
				refreshUri: (uri: vscode.Uri) => void;
				refresh: (session: unknown) => Promise<void>;
			};
			const originalRefresh = internals.refresh.bind(coordinator);
			let refreshes = 0;
			internals.refresh = async (session) => {
				refreshes += 1;
				await originalRefresh(session);
			};

			internals.refreshUri(sourceUri);
			internals.refreshUri(sourceUri);
			internals.refreshUri(sourceUri);
			await delay(50);
			assert.strictEqual(refreshes, 0);
			await delay(200);
			assert.strictEqual(refreshes, 1);

			refreshes = 0;
			internals.refreshUri(sourceUri);
			await coordinator.reload(sourceUri);
			assert.strictEqual(refreshes, 1);
			await delay(200);
			assert.strictEqual(refreshes, 1);
		} finally {
			coordinator.dispose();
			output.dispose();
		}
	});
});

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
