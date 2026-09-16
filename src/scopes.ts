/**
 * スコープルートの検出と分配（VS Code API 非依存）．
 *
 * スコープルートは「配下の分類を所有するフォルダ」である．個人ボールト（ワークスペース
 * フォルダ自身）も 1 つのスコープルートで，特別扱いはしない．宣言されたスコープルートの
 * 配下を祖先が分類することはない（フレームの入れ子を潰さない）．
 *
 * 検出源は今のところ `.gitmodules` だけ．将来の宣言レジストリ
 * （`.irori/mounts.yaml`）は {@link ScopeRoot} を作る経路が 1 本増えるだけで，
 * 分配（{@link attachScopes}）と分類（{@link classifyByScope}）は変わらない．
 */
import {
	ClassificationResult,
	ClassifiedFile,
	classifyFiles,
	FileScope,
	LayerDefinition,
	OTHER_LAYER_ID,
	ScopedFile,
	sortFiles,
	WORKSPACE_SCOPE_ID,
} from './layers';

/** 検出されたスコープルート（ワークスペースフォルダごとに 1 組） */
export interface ScopeRoot extends FileScope {
	/** 複数ルート時のワークスペースフォルダ名（単一ルートなら undefined） */
	rootLabel?: string;
}

export interface ScopeRootsOptions {
	/** 複数ルート時のワークスペースフォルダ名（単一ルートなら undefined） */
	rootLabel?: string;
	/** ワークスペースフォルダの表示名（個人ボールトのラベル） */
	label: string;
	/** `.gitmodules` が宣言する submodule のパス（ワークスペースフォルダ相対） */
	submodulePaths: readonly string[];
}

/**
 * `.gitmodules` から submodule の `path` を取り出す．
 *
 * ワークスペースフォルダの外を指しうるパス（絶対パス，`..` を含むパス）は，
 * スコープの所有関係をパスの前方一致で決める以上そのまま扱えないので捨てる．
 */
export function parseGitmodulePaths(text: string): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	let inSubmodule = false;
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith('[')) {
			inSubmodule = /^\[submodule(\s|\])/i.test(trimmed);
			continue;
		}
		if (!inSubmodule) {
			continue;
		}
		const match = /^path\s*=\s*(.*)$/i.exec(trimmed);
		if (!match) {
			continue;
		}
		const value = normalizeScopePath(stripQuotes(match[1].trim()));
		if (!isSafeScopePath(value) || seen.has(value)) {
			continue;
		}
		seen.add(value);
		paths.push(value);
	}
	return paths;
}

/** ワークスペースフォルダ自身と，検出された submodule のスコープルートを組み立てる */
export function buildScopeRoots(options: ScopeRootsOptions): ScopeRoot[] {
	const workspaceScope: ScopeRoot = {
		id: scopeIdOf(options.rootLabel, ''),
		rootLabel: options.rootLabel,
		path: '',
		label: options.label,
		kind: 'workspace',
	};
	const submodules = options.submodulePaths
		.map((raw) => normalizeScopePath(raw))
		.filter((path) => isSafeScopePath(path))
		.map((path): ScopeRoot => ({
			id: scopeIdOf(options.rootLabel, path),
			rootLabel: options.rootLabel,
			path,
			label: basename(path),
			kind: 'submodule',
		}));
	return [workspaceScope, ...submodules];
}

/**
 * ファイルを所有するスコープルート（最も近い祖先）を返す．
 * ルート名（複数ルート時のワークスペースフォルダ）が一致するものだけを見る．
 *
 * 宣言されたスコープルートは，祖先の交換面（`contents/`）の中にあっても分類を所有する．
 * 交換面は「宣言が無い場所」を種別で分類しないための規則であり，宣言を上書きしない．
 * ただし規約上スコープルートは交換面の外に置く（`contents/` は交換材料だけを持つ）．
 */
export function findScopeRoot(file: ClassifiedFile, scopes: readonly ScopeRoot[]): ScopeRoot | undefined {
	let best: ScopeRoot | undefined;
	for (const scope of scopes) {
		if (scope.rootLabel !== file.rootLabel) {
			continue;
		}
		if (!encloses(scope.path, file.relativePath)) {
			continue;
		}
		if (!best || scope.path.length > best.path.length) {
			best = scope;
		}
	}
	return best;
}

/**
 * 全ファイルにスコープとスコープ相対パスを付ける．
 * 該当するスコープルートが無い場合でも「ワークスペースフォルダ自身」を補うので，
 * 戻り値のファイルは必ずスコープを持つ．
 */
export function attachScopes(files: readonly ClassifiedFile[], scopes: readonly ScopeRoot[]): ScopedFile[] {
	const fallbacks = new Map<string, ScopeRoot>();
	return files.map((file) => {
		const scope = findScopeRoot(file, scopes) ?? fallbackScope(file.rootLabel, fallbacks);
		return {
			...file,
			scope: toFileScope(scope),
			scopePath: scope.path ? file.relativePath.slice(scope.path.length + 1) : file.relativePath,
		};
	});
}

/**
 * スコープルートごとに分配してから，各フレームの中で {@link classifyFiles} を回す．
 *
 * レイヤー定義は今はどのスコープでも同じものを使う（スコープ自身が宣言するレイヤーを
 * 読むのは後の段階）．並び順は従来どおりツリー上のパス順で，フレームをまたいでも
 * 1 つの一覧として安定する．
 */
export function classifyByScope(
	files: readonly ClassifiedFile[],
	scopes: readonly ScopeRoot[],
	layers: LayerDefinition[]
): ClassificationResult {
	const scoped = attachScopes(files, scopes);
	const byLayer = new Map<string, ClassifiedFile[]>();
	for (const layer of layers) {
		byLayer.set(layer.id, []);
	}
	byLayer.set(OTHER_LAYER_ID, []);
	const layerOfFile = new Map<string, string>();

	for (const partition of partitionByScope(scoped).values()) {
		const result = classifyFiles(partition, layers);
		for (const [layerId, list] of result.byLayer) {
			const merged = byLayer.get(layerId) ?? [];
			merged.push(...list);
			byLayer.set(layerId, merged);
		}
		for (const [key, layerId] of result.layerOfFile) {
			layerOfFile.set(key, layerId);
		}
	}

	for (const list of byLayer.values()) {
		sortFiles(list);
	}
	return { byLayer, layerOfFile };
}

/** スコープ ID ごとにファイルをまとめる */
export function partitionByScope(files: readonly ScopedFile[]): Map<string, ScopedFile[]> {
	const partitions = new Map<string, ScopedFile[]>();
	for (const file of files) {
		const list = partitions.get(file.scope.id);
		if (list) {
			list.push(file);
			continue;
		}
		partitions.set(file.scope.id, [file]);
	}
	return partitions;
}

/** スコープルートの ID（複数ルート時はルート名を前置し，全体で一意にする） */
export function scopeIdOf(rootLabel: string | undefined, path: string): string {
	const parts = [rootLabel, path].filter((part): part is string => !!part);
	return parts.length > 0 ? parts.join('/') : WORKSPACE_SCOPE_ID;
}

function toFileScope(scope: ScopeRoot): FileScope {
	return { id: scope.id, path: scope.path, label: scope.label, kind: scope.kind };
}

/** スコープルートが見つからないファイル用の，ワークスペースフォルダ相当のスコープ */
function fallbackScope(rootLabel: string | undefined, cache: Map<string, ScopeRoot>): ScopeRoot {
	const id = scopeIdOf(rootLabel, '');
	const cached = cache.get(id);
	if (cached) {
		return cached;
	}
	const scope: ScopeRoot = { id, rootLabel, path: '', label: rootLabel ?? '', kind: 'workspace' };
	cache.set(id, scope);
	return scope;
}

/** `scopePath` の配下に `relativePath` があるか（パス区切り単位で判定する） */
function encloses(scopePath: string, relativePath: string): boolean {
	if (scopePath === '') {
		return true;
	}
	return relativePath.startsWith(`${scopePath}/`);
}

function normalizeScopePath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/^(\.\/)+/, '')
		.replace(/\/+$/, '')
		.trim();
}

/** ワークスペースフォルダの内側を指す相対パスか */
function isSafeScopePath(path: string): boolean {
	// 空・絶対パス・ドライブ修飾（C:/…）・UNC（//host/share）・制御文字を弾く
	// eslint-disable-next-line no-control-regex
	if (path.length === 0 || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || /[\u0000-\u001f]/.test(path)) {
		return false;
	}
	return path.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function stripQuotes(value: string): string {
	const quoted = /^"(.*)"$/.exec(value);
	return quoted ? quoted[1] : value;
}

function basename(path: string): string {
	const segments = path.split('/');
	return segments[segments.length - 1] ?? path;
}
