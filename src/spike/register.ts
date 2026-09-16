/**
 * SPIKE (2026-09-08) — additive registration for the grid prototype.
 *
 * The only thing `src/extension.ts` has to do is call `registerSpikeGrid`.
 * Everything the prototype contributes is gated behind the default-off setting
 * `irori.spike.enableGrid`, so the shipped sidebar is unchanged unless a
 * user opts in.
 */
import * as vscode from 'vscode';
import { BenchRequest, DEFAULT_BENCH_REQUEST, runBenchmark } from './bench/benchmark';
import { ExpandMode, SPIKE_VIEW_ID, SpikeGridViewProvider } from './gridView';
import { buildGridModel, DEFAULT_GRID_OPTIONS, GridModel } from './gridModel';
import { buildRealGridModel } from './realModel';
import { DEEP_SHAPE, generateVault } from './synthetic';
import { WorkspaceIndex } from '../workspaceIndex';

interface SyntheticOptions {
	fileCount?: number;
	depth?: number;
	branching?: number;
	expand?: ExpandMode;
}

interface WorkspaceOptions {
	expand?: ExpandMode;
}

const DEFAULT_SYNTHETIC_FILES = 15118;
import { DEFAULT_LAYERS } from '../layers';

const ENABLE_SETTING = 'irori.spike.enableGrid';
const FOCUS_RETRIES = 20;
const FOCUS_RETRY_DELAY_MS = 250;
const THEME_SETTLE_MS = 1500;
const DEFAULT_THEMES = ['Default Dark Modern', 'Default Light Modern', 'Default High Contrast'];

let panel: vscode.WebviewPanel | undefined;
let panelProvider: SpikeGridViewProvider | undefined;

/**
 * Which vault the side bar grid is showing. `workspace` is the real index;
 * `synthetic` is the generated vault the benchmark and screenshot harnesses
 * need, and it wins until something asks for the workspace again — otherwise a
 * file-system event would silently replace a measurement's input mid-run.
 */
type GridSource = 'workspace' | 'synthetic';

let gridSource: GridSource = 'workspace';

/** The real workspace, as the index currently sees it. */
function workspaceModel(index: WorkspaceIndex): GridModel {
	return buildRealGridModel({
		byLayer: index.result.byLayer,
		scopes: index.scopes,
		mounts: index.mounts,
		layers: index.config.layers,
		compact: index.config.compactFolders,
	});
}

function syntheticModel(options?: SyntheticOptions) {
	const files = generateVault({
		fileCount: options?.fileCount ?? DEFAULT_SYNTHETIC_FILES,
		depth: options?.depth ?? DEEP_SHAPE.depth,
		branching: options?.branching ?? DEEP_SHAPE.branching,
	});
	return buildGridModel(files, DEFAULT_LAYERS, DEFAULT_GRID_OPTIONS);
}

/**
 * @param index the live workspace index; when omitted the grid can only show
 *              the synthetic vault (the benchmark harness's mode).
 */
export function registerSpikeGrid(context: vscode.ExtensionContext, index?: WorkspaceIndex): void {
	const showWorkspace = async (expand: ExpandMode = 'default'): Promise<unknown> => {
		if (!index) {
			throw new Error('spike grid: no workspace index was passed to registerSpikeGrid');
		}
		gridSource = 'workspace';
		return provider.setModel(workspaceModel(index), 'virtual', expand);
	};
	// Fill the view with the real vault as soon as VS Code resolves it, so
	// opening the side bar shows the workspace rather than an empty grid.
	const provider = new SpikeGridViewProvider(context.extensionUri, false, () => {
		if (!index || gridSource !== 'workspace') {
			return;
		}
		void showWorkspace().catch((error) => console.log(`[irori spike] initial load failed: ${String(error)}`));
	});
	if (index) {
		// The same refresh signal the tree slots follow: the index fires after a
		// scan, which its own watcher schedules on create/delete, and which
		// `reloadConfig` re-runs on a configuration change.
		context.subscriptions.push(
			index.onDidChange(() => {
				if (gridSource !== 'workspace' || !provider.isResolved) {
					return;
				}
				void showWorkspace().catch((error) => console.log(`[irori spike] refresh failed: ${String(error)}`));
			})
		);
	}
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SPIKE_VIEW_ID, provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('irori.spike.openGrid', () => openGrid(provider)),
		vscode.commands.registerCommand('irori.spike.loadSynthetic', async (options?: SyntheticOptions) => {
			await openGrid(provider);
			gridSource = 'synthetic';
			return provider.setModel(syntheticModel(options), 'virtual', options?.expand ?? 'default');
		}),
		vscode.commands.registerCommand('irori.spike.loadWorkspace', async (options?: WorkspaceOptions) => {
			await openGrid(provider);
			await index?.refresh();
			return showWorkspace(options?.expand ?? 'default');
		}),
		vscode.commands.registerCommand('irori.spike.probe', () => provider.request({ type: 'probe-theme' })),
		// Screenshot support only: fold the mounts shut and scroll them into view.
		vscode.commands.registerCommand('irori.spike.focusMounts', () => provider.request({ type: 'focus-mounts' })),
		vscode.commands.registerCommand('irori.spike.openGridPanel', async (options?: SyntheticOptions) => {
			// Same renderer, hosted in the editor area, where horizontal space exists.
			if (!panel) {
				panel = vscode.window.createWebviewPanel(
					'irori.spike.gridPanel',
					'irori Grid (spike)',
					vscode.ViewColumn.One,
					{
						enableScripts: true,
						localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'spike', 'media')],
					}
				);
				panelProvider = new SpikeGridViewProvider(context.extensionUri);
				panelProvider.attach(panel);
				panel.onDidDispose(() => {
					panel = undefined;
					panelProvider = undefined;
				});
			} else {
				panel.reveal(vscode.ViewColumn.One);
			}
			await panelProvider!.waitForReady();
			gridSource = 'synthetic';
			const result = await panelProvider!.setModel(syntheticModel(options), 'virtual', options?.expand ?? 'default');
			// Reveal after the first paint: a panel revealed while still empty can
			// stay an uncomposited frame in a headless session.
			panel.reveal(vscode.ViewColumn.One, false);
			return result;
		}),
		vscode.commands.registerCommand('irori.spike.probeThemes', async (themes?: string[]) => {
			await openGrid(provider);
			gridSource = 'synthetic';
			const files = generateVault({ fileCount: 500, ...DEEP_SHAPE });
			await provider.setModel(buildGridModel(files, DEFAULT_LAYERS, DEFAULT_GRID_OPTIONS), 'virtual');
			const results: Record<string, unknown> = {};
			const workbench = vscode.workspace.getConfiguration('workbench');
			const original = workbench.get<string>('colorTheme');
			for (const theme of themes ?? DEFAULT_THEMES) {
				await workbench.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
				await delay(THEME_SETTLE_MS);
				results[theme] = await provider.request({ type: 'probe-theme' });
			}
			await workbench.update('colorTheme', original, vscode.ConfigurationTarget.Global);
			return results;
		}),
		vscode.commands.registerCommand('irori.spike.runBench', async (request?: Partial<BenchRequest>) => {
			await openGrid(provider);
			gridSource = 'synthetic';
			return runBenchmark(provider, { ...DEFAULT_BENCH_REQUEST, ...request });
		})
	);
}

async function openGrid(provider: SpikeGridViewProvider): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	if (config.get<boolean>(ENABLE_SETTING) !== true) {
		await config.update(ENABLE_SETTING, true, vscode.ConfigurationTarget.Global);
		// The view's `when` clause is re-evaluated asynchronously after the update.
		await delay(FOCUS_RETRY_DELAY_MS);
	}
	await vscode.commands.executeCommand('workbench.view.extension.irori');
	for (let attempt = 0; attempt < FOCUS_RETRIES; attempt++) {
		try {
			await vscode.commands.executeCommand(`${SPIKE_VIEW_ID}.focus`);
		} catch (error) {
			console.log(`[irori spike] focus attempt ${attempt} failed: ${String(error)}`);
		}
		if (provider.isResolved) {
			console.log(`[irori spike] view resolved after ${attempt + 1} attempt(s)`);
			await provider.waitForReady();
			return;
		}
		await delay(FOCUS_RETRY_DELAY_MS);
	}
	throw new Error(`spike view ${SPIKE_VIEW_ID} never became available`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
