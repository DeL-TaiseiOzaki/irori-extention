import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CONFIG_SECTION, IroriConfig, readConfig } from './config';
import {
	ClassificationResult,
	ClassifiedFile,
	compileMatcher,
	EXCHANGE_SURFACE_DIR,
	filterExternalFiles,
	hasExternalRoots,
	hasUsableExternalRoots,
	LayerDefinition,
} from './layers';
import { collectMountPoints, MountObservation, MountPoint, mountDisplayPath } from './mounts';
import { buildScopeRoots, classifyByScope, parseGitmodulePaths, ScopeRoot } from './scopes';
import { walkDirectory, WalkDiagnostics, WalkPort } from './walk';

/**
 * ワークスペース（と各レイヤーの外部フォルダ）を走査してレイヤー分類を保持する．
 * 各レイヤーのツリービューとエクスプローラー装飾がこのインデックスを参照する．
 */
export class WorkspaceIndex implements vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private _config: IroriConfig = readConfig();
	private _result: ClassificationResult = { byLayer: new Map(), layerOfFile: new Map() };
	private _scopes: ScopeRoot[] = [];
	private _mounts: MountPoint[] = [];
	private _uris = new Map<string, vscode.Uri>();
	private _pending: Promise<void> | undefined;
	private _dirty = false;
	private _debounce: NodeJS.Timeout | undefined;
	private _externalWatchers: vscode.Disposable[] = [];
	private _warned = new Set<string>();
	private readonly _disposables: vscode.Disposable[] = [];

	constructor() {
		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
		this._disposables.push(
			watcher,
			watcher.onDidCreate(() => this.scheduleRefresh()),
			watcher.onDidDelete(() => this.scheduleRefresh()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
			this._onDidChange
		);
	}

	get config(): IroriConfig {
		return this._config;
	}

	get result(): ClassificationResult {
		return this._result;
	}

	/** 検出済みのスコープルート（ワークスペースフォルダ自身と git submodule） */
	get scopes(): readonly ScopeRoot[] {
		return this._scopes;
	}

	/** 交換面（`contents/`）直下のマウント点と，その状態 */
	get mounts(): readonly MountPoint[] {
		return this._mounts;
	}

	filesOf(layerId: string): ClassifiedFile[] {
		return this._result.byLayer.get(layerId) ?? [];
	}

	uriOf(file: ClassifiedFile): vscode.Uri | undefined {
		return this._uris.get(file.key);
	}

	layerOf(uri: vscode.Uri): string | undefined {
		return this._result.layerOfFile.get(uri.toString());
	}

	/** 設定を読み直してから再走査する */
	reloadConfig(): Promise<void> {
		this._config = readConfig();
		// 設定を直したら診断も出し直す
		this._warned = new Set<string>();
		return this.refresh();
	}

	scheduleRefresh(delayMs = 300): void {
		if (this._debounce) {
			clearTimeout(this._debounce);
		}
		this._debounce = setTimeout(() => {
			this._debounce = undefined;
			void this.refresh();
		}, delayMs);
	}

	/** 走査を実行する．走査中に呼ばれた場合は完了後にもう一度走査する． */
	refresh(): Promise<void> {
		if (this._pending) {
			this._dirty = true;
			return this._pending;
		}
		this._pending = this.scan()
			.catch((err) => {
				console.error('[irori] scan failed', err);
			})
			.finally(() => {
				this._pending = undefined;
				if (this._dirty) {
					this._dirty = false;
					void this.refresh();
				}
			});
		return this._pending;
	}

	private async scan(): Promise<void> {
		const uris = new Map<string, vscode.Uri>();
		const folders = vscode.workspace.workspaceFolders ?? [];
		const scopes = await detectScopeRoots(folders);
		const mounts = await detectMounts(folders);
		const workspaceFiles = await this.scanWorkspace(uris);
		const result = classifyByScope(workspaceFiles, scopes, this._config.layers);
		this.reportMounts(mounts);

		const followSymlinks = readFollowSymlinks();

		const externalRoots: vscode.Uri[] = [];
		for (const layer of this._config.layers) {
			if (!hasExternalRoots(layer)) {
				continue;
			}
			if (!hasUsableExternalRoots(layer)) {
				this.warnOnce(
					`unconfigured:${layer.id}`,
					`irori: レイヤー「${layer.label}」は外部フォルダ専用ですが roots が空です．irori.layers で走査するフォルダを設定してください．`
				);
				continue;
			}
			const roots = resolveRoots(layer.roots ?? []);
			if (roots.length === 0) {
				this.warnOnce(
					`unresolved:${layer.id}`,
					`irori: レイヤー「${layer.label}」の roots を解決できませんでした．相対パスはフォルダーを開いてから解決されます．`
				);
				continue;
			}
			externalRoots.push(...roots);
			const found = await this.scanExternal(layer, roots, uris, followSymlinks);
			const files = filterExternalFiles(found, layer);
			result.byLayer.set(layer.id, files);
			for (const f of files) {
				result.layerOfFile.set(f.key, layer.id);
			}
		}

		this._uris = uris;
		this._result = result;
		this._scopes = scopes;
		this._mounts = mounts;
		this.watchExternalRoots(externalRoots);
		this._onDidChange.fire();
	}

	private async scanWorkspace(uris: Map<string, vscode.Uri>): Promise<ClassifiedFile[]> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		const multiRoot = folders.length > 1;
		const exclude = this._config.exclude.length > 0 ? `{${this._config.exclude.join(',')}}` : undefined;
		const files: ClassifiedFile[] = [];
		for (const folder of folders) {
			const include = new vscode.RelativePattern(folder, '**/*');
			const found = exclude
				? await vscode.workspace.findFiles(include, new vscode.RelativePattern(folder, exclude))
				: await vscode.workspace.findFiles(include);
			for (const uri of found) {
				const relativePath = toPosix(vscode.workspace.asRelativePath(uri, false));
				const key = uri.toString();
				uris.set(key, uri);
				files.push({ key, relativePath, rootLabel: multiRoot ? folder.name : undefined });
			}
		}
		return files;
	}

	private async scanExternal(
		layer: LayerDefinition,
		roots: vscode.Uri[],
		uris: Map<string, vscode.Uri>,
		followSymlinks: boolean
	): Promise<ClassifiedFile[]> {
		const excluded = compileMatcher(this._config.exclude);
		const multi = roots.length > 1;
		const files: ClassifiedFile[] = [];
		for (const root of roots) {
			const rootLabel = multi ? path.basename(root.fsPath) || root.fsPath : undefined;
			try {
				const diagnostics = await walkDirectory(createWalkPort(root), {
					followSymlinks,
					excluded,
					visit: (relativePath) => {
						const uri = childUri(root, relativePath);
						const key = uri.toString();
						uris.set(key, uri);
						files.push({ key, relativePath, rootLabel });
					},
				});
				this.reportWalk(layer, root, diagnostics, followSymlinks);
			} catch (err) {
				console.warn(`[irori] レイヤー "${layer.id}" の roots を読めません: ${root.fsPath}`, err);
			}
		}
		return files;
	}

	/**
	 * 繋がっていないマウント点と，マウントの位置にあるローカルデータを利用者に伝える．
	 * `findFiles` は辿れない入口を黙って無視するので，何も言わなければ
	 * 「マウントされていない」と「空」が見分けられない．ローカルデータの方は逆に
	 * 普通のフォルダとして黙って表示されてしまい，バックアップされていないことが見えない．
	 */
	private reportMounts(mounts: readonly MountPoint[]): void {
		for (const mount of mounts) {
			const where = mountDisplayPath(mount);
			if (mount.state === 'unavailable') {
				this.warnOnce(
					`mount-unavailable:${where}`,
					`irori: ${where} はこの端末にマウントされていません（参照先が見つかりません）．` +
						`中身は表示されません．`
				);
				continue;
			}
			if (mount.state === 'local-data') {
				this.warnOnce(
					`mount-local-data:${where}`,
					`irori: ${where} はマウントではなく，この端末のローカルディレクトリとして見えています` +
						`（交換面と同じディスク上の実体で，マウント境界がありません）．` +
						`マウントに失敗したまま実体が作られた可能性があります．` +
						`${EXCHANGE_SURFACE_DIR}/ はバージョン管理の対象外なので，この中のデータは` +
						`この端末にしか存在せず，どこにもバックアップされていません．`
				);
			}
		}
	}

	/** 走査結果の診断を利用者に伝える．空パネル・欠落の理由を黙って隠さないための経路． */
	private reportWalk(
		layer: LayerDefinition,
		root: vscode.Uri,
		diagnostics: WalkDiagnostics,
		followSymlinks: boolean
	): void {
		const where = `レイヤー「${layer.label}」の ${root.fsPath}`;
		if (!followSymlinks && diagnostics.skippedSymlinks > 0) {
			this.warnOnce(
				`symlink:${layer.id}:${root.toString()}`,
				`irori: ${where} でシンボリックリンク ${diagnostics.skippedSymlinks} 件をスキップしました．` +
					`Google Drive などのマウントを取り込むには irori.followSymlinks を有効にしてください．`
			);
		}
		if (diagnostics.truncatedBy !== undefined) {
			this.warnOnce(
				`truncated:${layer.id}:${root.toString()}`,
				`irori: ${where} の走査を上限（${diagnostics.truncatedBy}）で打ち切りました．` +
					`一部のファイルは表示されません: ${diagnostics.truncatedAt}`
			);
		}
		if (diagnostics.cycles > 0 || diagnostics.unresolvedSymlinks > 0) {
			console.warn(
				`[irori] ${where}: 循環 ${diagnostics.cycles} 件，解決できないリンク ${diagnostics.unresolvedSymlinks} 件をスキップしました．`
			);
		}
	}

	/** 同じ理由の警告は 1 度だけ出す（走査のたびに通知しないため） */
	private warnOnce(key: string, message: string): void {
		if (this._warned.has(key)) {
			return;
		}
		this._warned.add(key);
		console.warn(`[irori] ${message}`);
		void vscode.window.showWarningMessage(message);
	}

	private watchExternalRoots(roots: vscode.Uri[]): void {
		vscode.Disposable.from(...this._externalWatchers).dispose();
		this._externalWatchers = [];
		const workspaceRoots = new Set((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString()));
		for (const root of roots) {
			if (workspaceRoots.has(root.toString())) {
				continue;
			}
			const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'), false, true, false);
			this._externalWatchers.push(
				watcher,
				watcher.onDidCreate(() => this.scheduleRefresh()),
				watcher.onDidDelete(() => this.scheduleRefresh())
			);
		}
	}

	dispose(): void {
		if (this._debounce) {
			clearTimeout(this._debounce);
		}
		vscode.Disposable.from(...this._externalWatchers, ...this._disposables).dispose();
	}
}

/**
 * ワークスペースフォルダごとにスコープルートを検出する．
 * 検出源は `.gitmodules` だけ（宣言レジストリは後の段階）．読めなければ
 * そのフォルダ自身の 1 スコープになる．
 */
export async function detectScopeRoots(folders: readonly vscode.WorkspaceFolder[]): Promise<ScopeRoot[]> {
	const multiRoot = folders.length > 1;
	const scopes: ScopeRoot[] = [];
	for (const folder of folders) {
		const submodulePaths = await readGitmodulePaths(folder.uri);
		scopes.push(
			...buildScopeRoots({
				rootLabel: multiRoot ? folder.name : undefined,
				label: folder.name,
				submodulePaths,
			})
		);
	}
	return scopes;
}

async function readGitmodulePaths(folder: vscode.Uri): Promise<string[]> {
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, '.gitmodules'));
		return parseGitmodulePaths(new TextDecoder().decode(bytes));
	} catch {
		// .gitmodules が無いのは普通の状態なので黙って空扱いにする
		return [];
	}
}

/**
 * 交換面（`contents/`）直下のマウント点を調べる．交換面が無ければ空．
 *
 * 直下のエントリは種別を問わずすべてマウント点として扱う（`src/mounts.ts` の方針）．
 * ここでの観測は「繋がっているか」を決めるためだけのもので，そのために
 * 種別ビットに加えてデバイス ID を添える．
 */
export async function detectMounts(folders: readonly vscode.WorkspaceFolder[]): Promise<MountPoint[]> {
	const multiRoot = folders.length > 1;
	const mounts: MountPoint[] = [];
	for (const folder of folders) {
		const surface = vscode.Uri.joinPath(folder.uri, EXCHANGE_SURFACE_DIR);
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(surface);
		} catch {
			// 交換面が無いワークスペースはマウント点も無い
			continue;
		}
		const surfaceDevice = await deviceIdOf(surface);
		const observations: MountObservation[] = [];
		for (const [name, type] of entries) {
			observations.push({
				name,
				type,
				onSeparateDevice: await isOnSeparateDevice(vscode.Uri.joinPath(surface, name), surfaceDevice),
			});
		}
		mounts.push(...collectMountPoints(observations, EXCHANGE_SURFACE_DIR, multiRoot ? folder.name : undefined));
	}
	return mounts;
}

/**
 * そのパスが載っているファイルシステムのデバイス ID．
 * `file` スキーム以外（リモート・仮想ファイルシステム）と，辿れないパスでは観測できない．
 */
async function deviceIdOf(uri: vscode.Uri): Promise<number | undefined> {
	if (uri.scheme !== 'file') {
		return undefined;
	}
	try {
		// stat はリンクを辿る．マウントポイント自身のデバイスを見たいので lstat ではない．
		return (await fs.stat(uri.fsPath)).dev;
	} catch {
		return undefined;
	}
}

/** 交換面とは別のデバイスに載っているか．どちらかが観測できなければ undefined． */
async function isOnSeparateDevice(entry: vscode.Uri, surfaceDevice: number | undefined): Promise<boolean | undefined> {
	if (surfaceDevice === undefined) {
		return undefined;
	}
	const device = await deviceIdOf(entry);
	return device === undefined ? undefined : device !== surfaceDevice;
}

/** `~` やワークスペース相対パスを解決して URI にする */
export function resolveRoots(roots: string[]): vscode.Uri[] {
	const firstFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const resolved: vscode.Uri[] = [];
	for (const raw of roots) {
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		let p = trimmed;
		if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) {
			p = path.join(os.homedir(), p.slice(1));
		}
		if (!path.isAbsolute(p)) {
			if (!firstFolder) {
				continue;
			}
			p = path.resolve(firstFolder, p);
		}
		resolved.push(vscode.Uri.file(p));
	}
	return resolved;
}

/** `irori.followSymlinks` の既定値．従来どおりリンクをスキップする． */
export const DEFAULT_FOLLOW_SYMLINKS = false;

/**
 * `irori.followSymlinks` を読む．
 *
 * 本来は `IroriConfig` に載せるべき設定だが，今回の修正では `config.ts` を
 * 変更しない方針のためここで直接読む（`affectsConfig` は `irori.*` 全体を
 * 見ているので，変更時の再走査は従来どおり働く）．
 */
function readFollowSymlinks(): boolean {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return cfg.get<boolean>('followSymlinks') ?? DEFAULT_FOLLOW_SYMLINKS;
}

/** ルートからの相対パス（`/` 区切り）を URI にする */
function childUri(root: vscode.Uri, relativePath: string): vscode.Uri {
	return relativePath ? vscode.Uri.joinPath(root, ...relativePath.split('/')) : root;
}

/** VS Code のファイルシステム API を {@link WalkPort} に適合させる */
function createWalkPort(root: vscode.Uri): WalkPort {
	const rootFsPath = root.fsPath;
	// realpath は Node のファイルシステムを見るので file スキームでのみ意味を持つ．
	// 解決できない場合 walkDirectory はリンクを辿らないので，循環検出は常に有効なまま．
	const canResolve = root.scheme === 'file';
	return {
		async readDirectory(relativePath) {
			const entries = await vscode.workspace.fs.readDirectory(childUri(root, relativePath));
			// readDirectory はリンク先の種別を解決済みで返す（SymbolicLink | Directory など）ので，
			// 種別を知るための stat を自前で足す必要はない．
			return entries.map(([name, type]) => ({
				name,
				isFile: (type & vscode.FileType.File) !== 0,
				isDirectory: (type & vscode.FileType.Directory) !== 0,
				isSymbolicLink: (type & vscode.FileType.SymbolicLink) !== 0,
			}));
		},
		async realPath(relativePath) {
			if (!canResolve) {
				return undefined;
			}
			const native = relativePath ? path.join(rootFsPath, ...relativePath.split('/')) : rootFsPath;
			try {
				return await fs.realpath(native);
			} catch {
				return undefined;
			}
		},
		childPath(parentRealPath, name) {
			return path.join(parentRealPath, name);
		},
	};
}

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}
