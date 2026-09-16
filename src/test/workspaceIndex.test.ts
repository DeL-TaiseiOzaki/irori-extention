import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { detectMounts, detectScopeRoots } from '../workspaceIndex';

/**
 * スコープルート検出とマウント点検出は，実際の `vscode.workspace.fs` 越しに
 * `.gitmodules` と交換面を読む．「参照先の無いリンクは FileType 64 で返る」と
 * 「交換面直下の実ディレクトリは交換面と同じデバイスに載る」はどちらも実機の挙動が
 * 根拠なので，ここで本物の VS Code とファイルシステムに確かめさせる．
 */
suite('workspaceIndex: スコープルートとマウント点の検出', () => {
	let vaultPath: string;
	let folder: vscode.WorkspaceFolder;

	setup(async () => {
		vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'irori-vault-'));
		await fs.writeFile(
			path.join(vaultPath, '.gitmodules'),
			'[submodule "team-kb/engineering"]\n\tpath = team-kb/engineering\n\turl = ./somewhere\n'
		);
		await fs.mkdir(path.join(vaultPath, 'contents'), { recursive: true });
		await fs.mkdir(path.join(vaultPath, 'mount-target'), { recursive: true });
		await fs.symlink('../mount-target', path.join(vaultPath, 'contents', 'gdrive'));
		await fs.symlink('../not-mounted-here', path.join(vaultPath, 'contents', 'onedrive'));
		// マウントに失敗して実ディレクトリが作られた形（＝表に出すべき異常）
		await fs.mkdir(path.join(vaultPath, 'contents', 'failed-mount'), { recursive: true });
		await fs.writeFile(path.join(vaultPath, 'contents', 'failed-mount', 'note.md'), '# local only\n');
		folder = { uri: vscode.Uri.file(vaultPath), name: 'vault', index: 0 };
	});

	teardown(async () => {
		await fs.rm(vaultPath, { recursive: true, force: true });
	});

	test('.gitmodules の submodule がスコープルートとして検出される', async () => {
		const scopes = await detectScopeRoots([folder]);
		assert.deepStrictEqual(
			scopes.map((s) => [s.id, s.kind]),
			[
				['.', 'workspace'],
				['team-kb/engineering', 'submodule'],
			]
		);
	});

	test('交換面直下の 3 状態が実ファイルシステム越しに区別される', async () => {
		const mounts = await detectMounts([folder]);
		const states = new Map(mounts.map((m) => [m.path, m.state]));
		assert.strictEqual(states.get('contents/gdrive'), 'attached');
		assert.strictEqual(states.get('contents/onedrive'), 'unavailable');
		// 交換面と同じデバイスに載った実ディレクトリ＝マウントの位置にあるローカルデータ
		assert.strictEqual(states.get('contents/failed-mount'), 'local-data');
	});

	test('交換面直下は種別を問わずすべてマウント点として拾われる', async () => {
		const mounts = await detectMounts([folder]);
		assert.deepStrictEqual(
			mounts.map((m) => m.path).sort(),
			['contents/failed-mount', 'contents/gdrive', 'contents/onedrive']
		);
	});

	test('交換面も .gitmodules も無いフォルダでは何も検出しない', async () => {
		const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'irori-bare-'));
		try {
			const bareFolder: vscode.WorkspaceFolder = { uri: vscode.Uri.file(bare), name: 'bare', index: 0 };
			assert.deepStrictEqual(await detectMounts([bareFolder]), []);
			assert.deepStrictEqual(
				(await detectScopeRoots([bareFolder])).map((s) => s.path),
				['']
			);
		} finally {
			await fs.rm(bare, { recursive: true, force: true });
		}
	});
});
