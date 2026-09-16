/**
 * SPIKE (2026-09-09) — grid model for the *real* workspace.
 *
 * The VS Code-free half of "feed the grid from the real index": it takes the
 * classification `WorkspaceIndex` already produced and maps scope roots to the
 * five regions, replacing the path-hash stand-in in `buildGridModel`.
 *
 * Three rules carry the whole mapping:
 *  - my/team is `scope.kind` — 'workspace' is mine, 'submodule' is a team scope
 *    root and gets one group of its own, labelled from `scope.label`.
 *  - a team scope root's schema is never hoisted into the personal SCHEMA LAYER
 *    (decision of 2026-09-09). It stays inside that team's group as a layer
 *    sub-group, so it is visible *as schema* without being presented as the
 *    user's own. Every team group carries the same fixed layer sub-groups, so a
 *    file's address (`scope → layer → path`) does not change shape when an
 *    unrelated file is added; empty sub-groups are simply not rendered.
 *  - a mount point keeps its real position in the contents tree and says which
 *    of the three `MountState`s the index observed. Every direct child of the
 *    exchange surface is a mount by policy, so a row there is never an ordinary
 *    folder: it is attached (an expandable directory), not attached (a leaf,
 *    which is the only way an unattached mount is visible at all), or local
 *    data sitting where a mount should be — an anomaly, drawn as the expandable
 *    directory it really is, but marked as one.
 */
import {
	buildTree,
	ClassifiedFile,
	DirectoryNode,
	FileScope,
	LayerDefinition,
	findExchangeLayerId,
	OTHER_LAYER,
	OTHER_LAYER_ID,
	treePath,
} from '../layers';
import { MountPoint, MountState } from '../mounts';
import { findScopeRoot, ScopeRoot } from '../scopes';
import { flattenDirectory, GridModel, GridRow, RegionId, RegionModel } from './gridModel';

/** Layers whose files fill the full-width SCHEMA region. */
const SCHEMA_LAYER_IDS: readonly string[] = ['schema'];
/** Layers whose files fill the knowledge column. Everything else is contents. */
const KNOWLEDGE_LAYER_IDS: readonly string[] = ['knowledge', 'ontology'];

/** Which of the three region columns a layer belongs to. */
type RegionKind = 'schema' | 'knowledge' | 'contents';

/**
 * Badge text on a mount row. The position already says "this is a mount", so
 * the badge only has to say which state it is in.
 */
export const MOUNT_BADGE: Readonly<Record<MountState, string>> = {
	attached: 'mount',
	unavailable: 'not attached',
	'local-data': 'local only',
};

const MOUNT_TOOLTIP: Readonly<Record<MountState, string>> = {
	attached: 'Mount point: what is under it comes from outside the vault.',
	unavailable: 'Mount point not attached on this device — it cannot be opened, so nothing under it is listed.',
	'local-data':
		'Not a mount: a real local directory where a mount should be. contents/ is outside version control, ' +
		'so these files exist on this machine only and are backed up nowhere.',
};

/** Everything the grid needs from `WorkspaceIndex`, as plain data. */
export interface RealGridInput {
	/** `WorkspaceIndex.result.byLayer`: layer id → files (scopes already attached). */
	byLayer: ReadonlyMap<string, readonly ClassifiedFile[]>;
	/** `WorkspaceIndex.scopes`: the workspace folders themselves plus git submodules. */
	scopes: readonly ScopeRoot[];
	/** `WorkspaceIndex.mounts`: exchange-surface mount points and their state. */
	mounts: readonly MountPoint[];
	/** Active layer definitions, in configuration order (badges, labels, sub-group order). */
	layers: readonly LayerDefinition[];
	/** Passed through to `buildTree`. */
	compact: boolean;
}

interface Entry {
	file: ClassifiedFile;
	layerId: string;
}

interface Bucket {
	schema: Entry[];
	knowledge: Entry[];
	contents: Entry[];
}

interface TeamGroup {
	scope: FileScope;
	bucket: Bucket;
	mounts: MountPoint[];
}

interface RegionContext {
	compact: boolean;
	layers: readonly LayerDefinition[];
	order: ReadonlyMap<string, number>;
	badgeOf: (file: ClassifiedFile) => string | undefined;
	mountOf: (file: ClassifiedFile) => MountPoint | undefined;
}

/** Build the five-pane grid from the real classification. */
export function buildRealGridModel(input: RealGridInput): GridModel {
	const personal = emptyBucket();
	const personalMounts: MountPoint[] = [];
	const teams = new Map<string, TeamGroup>();

	// Declared submodules become groups even when they hold nothing in a pane:
	// an empty team scope root is a fact about the vault, not a reason to hide it.
	for (const scope of input.scopes) {
		if (scope.kind === 'submodule') {
			groupOf(teams, scope);
		}
	}

	const badgeByLayer = badgeMap(input.layers);
	const badgeOfKey = new Map<string, string>();
	for (const [layerId, files] of input.byLayer) {
		const kind = regionKindOf(layerId);
		const badge = badgeByLayer.get(layerId) ?? '·';
		for (const file of files) {
			badgeOfKey.set(file.key, badge);
			// A file with no scope comes from a layer's external `roots` — outside
			// every frame, and the user's own by construction.
			const bucket = file.scope?.kind === 'submodule' ? groupOf(teams, file.scope).bucket : personal;
			bucket[kind].push({ file, layerId });
		}
	}

	const mountByKey = new Map<string, MountPoint>();
	for (const mount of input.mounts) {
		mountByKey.set(mountKey(mount), mount);
		// Nearest enclosing scope root, so a mount inside a submodule lands in
		// that team's group rather than in the personal pane.
		const scope = findScopeRoot(mountAsFile(mount), input.scopes);
		if (scope?.kind === 'submodule') {
			groupOf(teams, scope).mounts.push(mount);
			continue;
		}
		personalMounts.push(mount);
	}

	const context: RegionContext = {
		compact: input.compact,
		layers: input.layers,
		order: layerOrder(input.layers),
		badgeOf: (file) => badgeOfKey.get(file.key),
		mountOf: (file) => mountByKey.get(file.key),
	};
	const groups = [...teams.values()].sort((a, b) => compare(a.scope.id, b.scope.id));

	const regions: RegionModel[] = [
		personalRegion('schema', 'SCHEMA LAYER', personal.schema, [], context),
		personalRegion('myKnowledge', 'MY KNOWLEDGE BASE', personal.knowledge, [], context),
		teamRegion('teamKnowledge', 'TEAM KNOWLEDGE BASES', groups, 'knowledge', context),
		personalRegion('myContents', 'MY CONTENTS', personal.contents, personalMounts, context),
		teamRegion('teamContents', 'TEAM CONTENTS', groups, 'contents', context),
	];

	return {
		regions,
		fileCount: regions.reduce((sum, region) => sum + region.fileCount, 0),
		rowCount: regions.reduce((sum, region) => sum + region.rows.length, 0),
	};
}

/**
 * A personal pane: one tree, with any mount point in place inside it.
 * The team scopes' schema does not appear here — see the module comment.
 */
function personalRegion(
	id: RegionId,
	label: string,
	entries: readonly Entry[],
	mounts: readonly MountPoint[],
	context: RegionContext
): RegionModel {
	return { id, label, fileCount: entries.length, rows: subtreeRows(entries, mounts, '', 0, context) };
}

/** A team pane: one collapsible group per team scope root, in scope id order. */
function teamRegion(
	id: RegionId,
	label: string,
	groups: readonly TeamGroup[],
	kind: RegionKind,
	context: RegionContext
): RegionModel {
	const rows: GridRow[] = [];
	let fileCount = 0;
	for (const group of groups) {
		// Schema belongs in the knowledge pane's group: it is part of that team's
		// frame, and the contents pane is an exchange surface, not a frame.
		const entries = kind === 'knowledge' ? [...group.bucket.schema, ...group.bucket.knowledge] : group.bucket.contents;
		const mounts = kind === 'contents' ? group.mounts : [];
		fileCount += entries.length;
		rows.push(...groupRows(group, entries, mounts, context));
	}
	return { id, label, fileCount, rows };
}

/**
 * One team group: a scope header, then one sub-group per layer present, then
 * that layer's subtree relative to the scope root. Mount points sit under a
 * layer sub-group of their own so the address stays `scope → layer → path`.
 */
function groupRows(
	group: TeamGroup,
	entries: readonly Entry[],
	mounts: readonly MountPoint[],
	context: RegionContext
): GridRow[] {
	const children: GridRow[] = [];
	for (const layerId of presentLayerIds(entries, mounts, context)) {
		const ofLayer = entries.filter((entry) => entry.layerId === layerId);
		const ofLayerMounts = isExchangeLayer(layerId, context) ? mounts : [];
		const rows = subtreeRows(ofLayer, ofLayerMounts, group.scope.path, 2, context);
		children.push({
			kind: 'group',
			name: layerLabel(layerId, context.layers),
			depth: 1,
			subtreeSize: rows.length,
			badge: String(ofLayer.length),
			addAction: false,
			variant: 'layer',
		});
		children.push(...rows);
	}
	return [
		{
			kind: 'group',
			name: group.scope.label,
			depth: 0,
			subtreeSize: children.length,
			badge: String(entries.length),
			addAction: true,
			variant: 'scope',
		},
		...children,
	];
}

/**
 * Flatten files and mount points into one tree.
 *
 * A mount keeps its real position. Whether it is expandable follows from what
 * the scan could list, not from its state, and conflating the two is what made
 * a live mount show up twice:
 *  - the scan listed something under it, so the tree already has a directory
 *    there — the row is marked as a mount and stays expandable. Both `attached`
 *    and `local-data` normally land here;
 *  - nothing under it was listed, so it enters as a placeholder and is drawn as
 *    a leaf. That is the only way an unattached mount is visible at all, and it
 *    also covers an attached-but-empty one.
 */
function subtreeRows(
	entries: readonly Entry[],
	mounts: readonly MountPoint[],
	scopePath: string,
	depth: number,
	context: RegionContext
): GridRow[] {
	const files = entries.map((entry) => asScopeRelative(entry.file, scopePath));
	const walked = directoryPaths(files);
	const mountByPath = new Map<string, MountPoint>();
	const placeholders: ClassifiedFile[] = [];
	for (const mount of mounts) {
		const placeholder = asScopeRelative(mountAsFile(mount), scopePath);
		// Keyed by tree path, which is what a directory node carries.
		const path = treePath(placeholder);
		mountByPath.set(path, mount);
		if (!walked.has(path)) {
			placeholders.push(placeholder);
		}
	}
	const tree = buildTree([...files, ...placeholders], context.compact);
	return flattenDirectory(tree, depth, context.badgeOf, (row, source) => {
		const mount = source.file ? context.mountOf(source.file) : mountOfNode(source.node, mountByPath);
		if (!mount) {
			return row;
		}
		return {
			// A directory keeps its kind: the scan reached its contents, so it is
			// still something to expand — it is just also a boundary.
			...row,
			kind: source.file ? 'mount' : row.kind,
			badge: MOUNT_BADGE[mount.state],
			mountState: mount.state,
			tooltip: MOUNT_TOOLTIP[mount.state],
		};
	});
}

/**
 * The mount a directory row stands for, if any.
 *
 * Compact folders collapse a single-child chain into one row that keeps the
 * deepest path, so a mount with exactly one child would otherwise lose its
 * badge. Every path the row covers is checked, not just its own.
 */
function mountOfNode(node: DirectoryNode | undefined, mountByPath: ReadonlyMap<string, MountPoint>): MountPoint | undefined {
	if (!node) {
		return undefined;
	}
	const segments = node.path.split('/');
	const collapsed = node.name.split('/').length;
	for (let i = 0; i < collapsed; i++) {
		const mount = mountByPath.get(segments.slice(0, segments.length - i).join('/'));
		if (mount) {
			return mount;
		}
	}
	return undefined;
}

/** Every directory the given files imply, as tree paths. */
function directoryPaths(files: readonly ClassifiedFile[]): Set<string> {
	const paths = new Set<string>();
	for (const file of files) {
		const segments = treePath(file).split('/');
		segments.pop();
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			paths.add(current);
		}
	}
	return paths;
}

/**
 * Re-anchor a file on its scope root, so a team group's tree starts below the
 * scope root instead of repeating `team-kb/engineering/` on every row. The key
 * is untouched, so badges, mount lookup and any future URI lookup still resolve.
 */
function asScopeRelative(file: ClassifiedFile, scopePath: string): ClassifiedFile {
	if (!scopePath) {
		return file;
	}
	const relativePath = file.scopePath ?? stripPrefix(file.relativePath, scopePath);
	return { ...file, relativePath, rootLabel: undefined };
}

function stripPrefix(relativePath: string, scopePath: string): string {
	return relativePath.startsWith(`${scopePath}/`) ? relativePath.slice(scopePath.length + 1) : relativePath;
}

function mountAsFile(mount: MountPoint): ClassifiedFile {
	return { key: mountKey(mount), relativePath: mount.path, rootLabel: mount.rootLabel };
}

function mountKey(mount: MountPoint): string {
	return `irori-mount:${mount.rootLabel ?? ''}/${mount.path}`;
}

function regionKindOf(layerId: string): RegionKind {
	if (SCHEMA_LAYER_IDS.includes(layerId)) {
		return 'schema';
	}
	if (KNOWLEDGE_LAYER_IDS.includes(layerId)) {
		return 'knowledge';
	}
	return 'contents';
}

function emptyBucket(): Bucket {
	return { schema: [], knowledge: [], contents: [] };
}

function groupOf(teams: Map<string, TeamGroup>, scope: FileScope): TeamGroup {
	const existing = teams.get(scope.id);
	if (existing) {
		return existing;
	}
	const created: TeamGroup = { scope, bucket: emptyBucket(), mounts: [] };
	teams.set(scope.id, created);
	return created;
}

function badgeMap(layers: readonly LayerDefinition[]): Map<string, string> {
	const badges = new Map<string, string>();
	for (const layer of layers) {
		badges.set(layer.id, layer.badge ?? layer.id.slice(0, 1).toUpperCase());
	}
	badges.set(OTHER_LAYER_ID, badges.get(OTHER_LAYER_ID) ?? '·');
	return badges;
}

/** Layer id → position, so sub-groups follow the configured layer order. */
function layerOrder(layers: readonly LayerDefinition[]): Map<string, number> {
	const order = new Map<string, number>();
	layers.forEach((layer, index) => order.set(layer.id, index));
	order.set(OTHER_LAYER_ID, order.get(OTHER_LAYER_ID) ?? layers.length);
	return order;
}

/**
 * Layers to render inside a group: those with files, plus the exchange-surface
 * layer when the group has mount points but no files under them.
 */
function presentLayerIds(
	entries: readonly Entry[],
	mounts: readonly MountPoint[],
	context: RegionContext
): string[] {
	const ids = new Set(entries.map((entry) => entry.layerId));
	if (mounts.length > 0) {
		ids.add(exchangeLayerId(context));
	}
	return [...ids].sort(
		(a, b) => (context.order.get(a) ?? Number.MAX_SAFE_INTEGER) - (context.order.get(b) ?? Number.MAX_SAFE_INTEGER)
	);
}

/**
 * The layer that owns `contents/`; mounts are drawn inside it. Same rule the
 * classifier uses, so an external-root layer is never mistaken for it.
 */
function exchangeLayerId(context: RegionContext): string {
	return findExchangeLayerId([...context.layers]) ?? OTHER_LAYER_ID;
}

function isExchangeLayer(layerId: string, context: RegionContext): boolean {
	return layerId === exchangeLayerId(context);
}

function layerLabel(layerId: string, layers: readonly LayerDefinition[]): string {
	if (layerId === OTHER_LAYER_ID) {
		return OTHER_LAYER.label;
	}
	return layers.find((layer) => layer.id === layerId)?.label ?? layerId;
}

function compare(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
