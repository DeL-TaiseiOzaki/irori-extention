/**
 * irori の中核ロジック（VS Code API 非依存）．
 *
 * ワークスペース内のファイルを「レイヤー」に分類し，レイヤーごとのツリーを組み立てる．
 * レイヤーは glob パターンの集合で定義され，先に定義されたレイヤーが優先される
 * （first-match-wins）．どのレイヤーにも一致しないファイルは "other" レイヤーに入る．
 *
 * `roots` を持つレイヤーはワークスペース外のフォルダ（Google Drive など）を
 * 走査対象とし，ワークスペース内のファイルとは独立して分類される．
 *
 * 分類は「フレーム相対」である．スコープルート（個人ボールト本体，git submodule など）が
 * その配下の分類を所有し，祖先はスコープルートの配下を分類しない．どのスコープルートが
 * どのファイルを所有するかを決めるのは `scopes.ts` の仕事で，本モジュールは与えられた
 * フレーム相対パス（{@link matchPath}）だけを見る．
 */
import { minimatch } from 'minimatch';

/** レイヤー定義（`irori.layers` 設定の 1 要素） */
export interface LayerDefinition {
	/** 一意な ID */
	id: string;
	/** パネルに表示する名前 */
	label: string;
	/** ツールチップなどに使う説明 */
	description?: string;
	/** codicon 名（例: "law", "book"） */
	icon?: string;
	/** エクスプローラーのバッジ（1〜2 文字） */
	badge?: string;
	/** エクスプローラー装飾に使うテーマカラー ID */
	color?: string;
	/** ルートからの相対 glob（ブレース展開・`**` 可） */
	patterns: string[];
	/**
	 * 走査するフォルダ（絶対パス，`~`，またはワークスペース相対パス）．
	 * 指定した場合，このレイヤーは指定フォルダだけを走査し，
	 * ワークスペース内ファイルの分類には参加しない．
	 */
	roots?: string[];
}

/** どのレイヤーにも属さないファイルを収める疑似レイヤーの ID */
export const OTHER_LAYER_ID = 'other';

/** 既定のレイヤー定義．上から順にマッチが試される． */
export const DEFAULT_LAYERS: LayerDefinition[] = [
	{
		id: 'schema',
		label: 'スキーマ層',
		description: 'CLI エージェントの振る舞いを規定する層（.claude, AGENTS.md など）',
		icon: 'law',
		badge: 'S',
		color: 'charts.purple',
		// スキーマはスコープルート直下に固定する（`**/` を付けない）．
		// 配下のスコープルート（submodule など）のスキーマはそのスコープ自身の
		// スキーマ層に入るべきで，親のスキーマ層へ持ち上げてはならない．
		patterns: [
			'.claude/**',
			'.claude.json',
			'CLAUDE.md',
			'CLAUDE.local.md',
			'AGENTS.md',
			'.agents/**',
			'.codex/**',
			'.cursor/**',
			'.cursorrules',
			'.gemini/**',
			'GEMINI.md',
			'.github/copilot-instructions.md',
			'.github/instructions/**',
			'.github/prompts/**',
			'.windsurfrules',
			'.mcp.json',
		],
	},
	{
		id: 'ontology',
		label: 'オントロジー層',
		description: 'この PKB のオントロジー（主に CSV）',
		icon: 'type-hierarchy',
		badge: 'O',
		color: 'charts.orange',
		patterns: ['**/*.csv', '**/*.tsv', 'ontology/**', 'ontologies/**'],
	},
	{
		id: 'knowledge',
		label: 'ナレッジベース層',
		description: 'メインの知見・情報（Markdown 群）',
		icon: 'book',
		badge: 'K',
		color: 'charts.blue',
		patterns: ['**/*.md', '**/*.mdx'],
	},
	{
		id: 'raw',
		label: 'Raw データ層',
		description:
			'生データ置き場（contents/ などのマウント先）．外部フォルダを走査するには roots にフォルダを，patterns に "**/*" を設定する',
		icon: 'database',
		badge: 'R',
		color: 'charts.green',
		patterns: ['contents/**', 'raw/**', 'data/**', 'attachments/**'],
	},
];

/** "other" 疑似レイヤーの表示定義 */
export const OTHER_LAYER: LayerDefinition = {
	id: OTHER_LAYER_ID,
	label: 'その他',
	description: 'どのレイヤーにも属さないファイル',
	icon: 'files',
	patterns: [],
};

/** スコープルートの見つけ方 */
export type ScopeKind =
	/** ワークスペースフォルダ自身（個人ボールト） */
	| 'workspace'
	/** `.gitmodules` に宣言された git submodule */
	| 'submodule';

/**
 * ファイルを所有するスコープルート．
 *
 * スコープルートは「配下の分類を所有するフォルダ」で，個人ボールト自身も
 * その 1 つ（特別扱いはしない）．ここに載るのは表示と経路に必要な最小限で，
 * 将来の宣言レジストリ（`.irori/mounts.yaml`）が増やすのは `kind` の
 * 値と付随するポリシーであって，この形ではない．
 */
export interface FileScope {
	/** スコープルートの一意な ID（単一ルートのワークスペース自身は {@link WORKSPACE_SCOPE_ID}） */
	id: string;
	/** ワークスペースフォルダから見たスコープルートのパス（`/` 区切り，ワークスペース自身は空文字） */
	path: string;
	/** 表示名 */
	label: string;
	kind: ScopeKind;
}

/** 分類対象となる 1 ファイル */
export interface ClassifiedFile {
	/** ファイルを一意に識別するキー（URI 文字列など） */
	key: string;
	/** ルートからの相対パス（区切りは `/`）．表示・ツリー構築に使う */
	relativePath: string;
	/** 複数ルート時にツリーの先頭に置くルート名（単一ルートなら undefined） */
	rootLabel?: string;
	/**
	 * このファイルを所有するスコープルート．
	 *
	 * ワークスペース内のファイルには `scopes.ts` の分配（`attachScopes`）が必ず入れる．
	 * 未指定は「まだ埋めていない」ではなく「どのフレームにも属さない」を意味し，
	 * レイヤーの `roots` から拾った外部フォルダのファイル（{@link filterExternalFiles}）が
	 * これに当たる．スコープが確定した型は {@link ScopedFile}．
	 */
	scope?: FileScope;
	/**
	 * スコープルートからの相対パス．レイヤー判定はこのパスに対して行う．
	 * 未指定なら {@link relativePath}（＝ワークスペース全体を 1 フレームと見なす）．
	 */
	scopePath?: string;
}

/**
 * スコープが解決済みのファイル．作れるのは `scopes.ts` の `attachScopes` だけで，
 * 「ワークスペース内のファイルは必ず所有スコープを持つ」という不変条件を型で表す．
 */
export type ScopedFile = ClassifiedFile & { scope: FileScope; scopePath: string };

/** ワークスペースフォルダ自身を表すスコープ ID（複数ルート時はルート名になる） */
export const WORKSPACE_SCOPE_ID = '.';

/**
 * 交換面（ホストが外部とやり取りするための面）のディレクトリ名．
 *
 * 各スコープルート直下のこのディレクトリは「置かれている場所」で定義される面であり，
 * 中身のファイル種別で分類してはならない．将来 `.irori/mounts.yaml` が
 * マウント点を宣言するようになっても，既定の面がこの名前である点は変わらない．
 */
export const EXCHANGE_SURFACE_DIR = 'contents';

export interface ClassificationResult {
	/** レイヤー ID → そのレイヤーに属するファイル（相対パス順） */
	byLayer: Map<string, ClassifiedFile[]>;
	/** ファイルキー → レイヤー ID */
	layerOfFile: Map<string, string>;
}

const MATCH_OPTIONS = { dot: true, nocomment: true } as const;

/** glob パターン群から `(relativePath) => boolean` を作る */
export function compileMatcher(patterns: string[]): (relativePath: string) => boolean {
	const matchers = patterns
		.map((p) => normalizePattern(p))
		.filter((p) => p.length > 0)
		.map((p) => minimatch.filter(p, MATCH_OPTIONS));
	return (relativePath) => matchers.some((m) => m(relativePath));
}

/** レイヤー定義から `(relativePath) => boolean` を作る */
export function compileLayerMatcher(layer: LayerDefinition): (relativePath: string) => boolean {
	return compileMatcher(layer.patterns);
}

/** 先頭の `./` や `/` を取り除き，区切りを `/` に揃える */
export function normalizePattern(pattern: string): string {
	return pattern.trim().replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

/**
 * `roots` を宣言しているレイヤーかどうか（＝ワークスペース内ファイルの分類に参加しない）．
 *
 * 空配列でも真になる．`roots: []` は「外部フォルダ専用だが走査先が未設定」という
 * 明示的に無効な状態を表し，ワークスペース内の分類に落ちてカタチが変わることはない．
 * 実際に走査するものがあるかは {@link hasUsableExternalRoots} で別に判定する．
 */
export function hasExternalRoots(layer: LayerDefinition): boolean {
	return Array.isArray(layer.roots);
}

/** 実際に走査できる `roots`（空白でない文字列）が 1 つ以上あるか */
export function hasUsableExternalRoots(layer: LayerDefinition): boolean {
	if (!Array.isArray(layer.roots)) {
		return false;
	}
	return layer.roots.some((root) => typeof root === 'string' && root.trim().length > 0);
}

/** レイヤー定義の妥当性を検証し，問題があれば理由を返す */
export function validateLayers(layers: LayerDefinition[]): string[] {
	const problems: string[] = [];
	const seen = new Set<string>();
	for (const layer of layers) {
		if (!layer.id || typeof layer.id !== 'string') {
			problems.push(`レイヤーに id がありません: ${JSON.stringify(layer)}`);
			continue;
		}
		if (layer.id === OTHER_LAYER_ID) {
			problems.push(`"${OTHER_LAYER_ID}" は予約された ID です`);
		}
		if (seen.has(layer.id)) {
			problems.push(`レイヤー ID が重複しています: ${layer.id}`);
		}
		seen.add(layer.id);
		if (!Array.isArray(layer.patterns) || layer.patterns.length === 0) {
			problems.push(`レイヤー "${layer.id}" に patterns がありません`);
		}
		if (layer.roots !== undefined && !Array.isArray(layer.roots)) {
			problems.push(`レイヤー "${layer.id}" の roots は配列である必要があります`);
		}
	}
	return problems;
}

/** レイヤー判定に使うフレーム相対パス（スコープ未解決なら従来どおりルート相対） */
export function matchPath(file: ClassifiedFile): string {
	return file.scopePath ?? file.relativePath;
}

/** フレーム相対パスが交換面（`contents/`）の中にあるか */
export function isUnderExchangeSurface(framePath: string): boolean {
	return framePath.startsWith(`${EXCHANGE_SURFACE_DIR}/`);
}

/**
 * 交換面を自分のものだと宣言しているレイヤーの ID．
 *
 * 「`contents/` 直下の何かに一致するパターンを持つ最初のレイヤー」であり，既定では
 * Raw データ層．複数が宣言していれば先勝ちで，他のパターン衝突と同じ規則に従う．
 *
 * 宣言するレイヤーが 1 つも無い設定では undefined を返し，その場合だけ交換面の除外は
 * 働かない．今の段階で「ここが交換面である」という宣言はレイヤー定義しかなく，
 * 宣言していない利用者にとって `contents/` はただのフォルダだからである
 * （`.irori/mounts.yaml` が入ったらそちらが宣言源になる）．
 */
export function findExchangeLayerId(layers: LayerDefinition[]): string | undefined {
	const claims = (layer: LayerDefinition): boolean =>
		layer.patterns.some((pattern) => {
			const normalized = normalizePattern(pattern);
			return normalized === EXCHANGE_SURFACE_DIR || normalized.startsWith(`${EXCHANGE_SURFACE_DIR}/`);
		});
	return layers.filter((layer) => !hasExternalRoots(layer)).find(claims)?.id;
}

/**
 * 1 つのフレーム（スコープルート）の中でファイル群をレイヤーに分類する．
 * `roots` を持つレイヤーは対象外（外部フォルダ専用）．レイヤーは定義順に評価され，
 * 最初に一致したレイヤーが採用される．どれにも一致しない場合は OTHER_LAYER_ID に入る．
 *
 * 判定に使うのは {@link matchPath}（= `scopePath ?? relativePath`）で，
 * 交換面（`contents/`）の中のファイルはパターン照合を行わず，
 * {@link findExchangeLayerId} のレイヤーにそのまま入る．
 * 複数のスコープルートにまたがるファイル群は `scopes.ts` の `classifyByScope` を使う．
 */
export function classifyFiles(files: ClassifiedFile[], layers: LayerDefinition[]): ClassificationResult {
	const matchers = layers
		.filter((layer) => !hasExternalRoots(layer))
		.map((layer) => ({ id: layer.id, matches: compileLayerMatcher(layer) }));
	const exchangeLayerId = findExchangeLayerId(layers);
	const byLayer = new Map<string, ClassifiedFile[]>();
	for (const layer of layers) {
		byLayer.set(layer.id, []);
	}
	byLayer.set(OTHER_LAYER_ID, []);
	const layerOfFile = new Map<string, string>();

	for (const file of files) {
		const id = layerIdOf(matchPath(file), matchers, exchangeLayerId);
		byLayer.get(id)!.push(file);
		layerOfFile.set(file.key, id);
	}

	for (const list of byLayer.values()) {
		sortFiles(list);
	}
	return { byLayer, layerOfFile };
}

/** フレーム相対パス 1 件のレイヤー ID を決める */
function layerIdOf(
	framePath: string,
	matchers: { id: string; matches: (relativePath: string) => boolean }[],
	exchangeLayerId: string | undefined
): string {
	if (exchangeLayerId !== undefined && isUnderExchangeSurface(framePath)) {
		return exchangeLayerId;
	}
	const hit = matchers.find((m) => m.matches(framePath));
	return hit ? hit.id : OTHER_LAYER_ID;
}

/** 外部フォルダから見つかったファイルのうち，レイヤーの patterns に一致するものを返す */
export function filterExternalFiles(files: ClassifiedFile[], layer: LayerDefinition): ClassifiedFile[] {
	const matches = compileLayerMatcher(layer);
	const result = files.filter((f) => matches(f.relativePath));
	sortFiles(result);
	return result;
}

/** ツリー上のパス順に並べ替える（分類結果の並びはこの順で安定させる） */
export function sortFiles(list: ClassifiedFile[]): void {
	list.sort((a, b) => (treePath(a) < treePath(b) ? -1 : treePath(a) > treePath(b) ? 1 : 0));
}

/** ツリー上でのフルパス（複数ルート時はルート名を先頭に付ける） */
export function treePath(file: ClassifiedFile): string {
	return file.rootLabel ? `${file.rootLabel}/${file.relativePath}` : file.relativePath;
}

// ---------------------------------------------------------------------------
// ツリー構築
// ---------------------------------------------------------------------------

export interface DirectoryNode {
	kind: 'directory';
	/** 表示名（compact 時は "a/b/c" のように連結される） */
	name: string;
	/** ツリールートからのパス（`/` 区切り） */
	path: string;
	directories: DirectoryNode[];
	files: FileNode[];
}

export interface FileNode {
	kind: 'file';
	name: string;
	path: string;
	file: ClassifiedFile;
}

export type TreeNode = DirectoryNode | FileNode;

/**
 * 相対パスの一覧からディレクトリツリーを組み立てる．
 * `compact` が真なら，子が 1 つのディレクトリしか持たないディレクトリを
 * エクスプローラーの「コンパクトフォルダー」と同様に連結する．
 */
export function buildTree(files: ClassifiedFile[], compact: boolean): DirectoryNode {
	const root: DirectoryNode = { kind: 'directory', name: '', path: '', directories: [], files: [] };

	for (const file of files) {
		const segments = treePath(file).split('/').filter((s) => s.length > 0);
		const fileName = segments.pop();
		if (!fileName) {
			continue;
		}
		let dir = root;
		let currentPath = '';
		for (const segment of segments) {
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			let next = dir.directories.find((d) => d.name === segment);
			if (!next) {
				next = { kind: 'directory', name: segment, path: currentPath, directories: [], files: [] };
				dir.directories.push(next);
			}
			dir = next;
		}
		dir.files.push({ kind: 'file', name: fileName, path: treePath(file), file });
	}

	sortTree(root);
	return compact ? compactTree(root) : root;
}

function sortTree(node: DirectoryNode): void {
	node.directories.sort((a, b) => a.name.localeCompare(b.name));
	node.files.sort((a, b) => a.name.localeCompare(b.name));
	node.directories.forEach(sortTree);
}

function compactTree(node: DirectoryNode): DirectoryNode {
	const directories = node.directories.map((child) => {
		let current = child;
		while (current.files.length === 0 && current.directories.length === 1) {
			const only = current.directories[0];
			current = { ...only, name: `${current.name}/${only.name}` };
		}
		return compactTree(current);
	});
	return { ...node, directories };
}

/** ノードの子要素（ディレクトリが先，次にファイル） */
export function childrenOf(node: DirectoryNode): TreeNode[] {
	return [...node.directories, ...node.files];
}
