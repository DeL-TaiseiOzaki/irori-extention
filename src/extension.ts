import * as vscode from 'vscode';
import { affectsConfig } from './config';
import { ExplorerDecorationProvider } from './explorerDecorations';
import { LayerDefinition, OTHER_LAYER } from './layers';
import { Element, LayerTreeProvider } from './layerTreeProvider';
import { registerSpikeGrid } from './spike/register';
import { WorkspaceIndex } from './workspaceIndex';

/** package.json に静的に宣言してあるビュー枠の数（レイヤー数の上限） */
export const SLOT_COUNT = 8;
export const slotViewId = (slot: number) => `irori.slot${slot}`;

interface Slot {
	provider: LayerTreeProvider;
	view: vscode.TreeView<Element>;
}

export function activate(context: vscode.ExtensionContext) {
	const index = new WorkspaceIndex();
	const decorations = new ExplorerDecorationProvider(index);

	// レイヤーごとに独立したパネル．ビューは動的に追加できないため，
	// 一定数の枠を用意して設定に応じてタイトルと表示/非表示を切り替える．
	const slots: Slot[] = [];
	for (let i = 0; i < SLOT_COUNT; i++) {
		const provider = new LayerTreeProvider(index);
		const view = vscode.window.createTreeView(slotViewId(i), { treeDataProvider: provider, showCollapseAll: true });
		slots.push({ provider, view });
		context.subscriptions.push(view);
	}

	const applyLayers = () => {
		const { layers, showOtherLayer } = index.config;
		const visible: LayerDefinition[] = showOtherLayer ? [...layers, OTHER_LAYER] : layers;
		if (visible.length > SLOT_COUNT) {
			void vscode.window.showWarningMessage(
				`irori: レイヤーは最大 ${SLOT_COUNT} 個まで表示できます．${visible.length - SLOT_COUNT} 個は表示されません．`
			);
		}
		slots.forEach(({ provider, view }, i) => {
			const layer = visible[i];
			provider.setLayer(layer);
			view.title = layer?.label ?? '';
			view.description = layer ? `${provider.fileCount}` : undefined;
			void vscode.commands.executeCommand('setContext', `irori.slot${i}.visible`, layer !== undefined);
		});
	};

	context.subscriptions.push(
		index,
		decorations,
		index.onDidChange(() => applyLayers()),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (affectsConfig(e)) {
				void index.reloadConfig();
			}
		}),
		vscode.commands.registerCommand('irori.refresh', () => index.refresh()),
		vscode.commands.registerCommand('irori.configureLayers', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'irori.layers')
		),
		vscode.commands.registerCommand('irori.openToSide', (element?: Element) => {
			const uri = resourceOf(index, element);
			if (uri) {
				return vscode.commands.executeCommand('vscode.open', uri, vscode.ViewColumn.Beside);
			}
		}),
		vscode.commands.registerCommand('irori.revealInExplorer', (element?: Element) => {
			const uri = resourceOf(index, element);
			if (uri) {
				return vscode.commands.executeCommand('revealInExplorer', uri);
			}
		}),
		vscode.commands.registerCommand('irori.revealFileInOS', (element?: Element) => {
			const uri = resourceOf(index, element);
			if (uri) {
				return vscode.commands.executeCommand('revealFileInOS', uri);
			}
		}),
		vscode.commands.registerCommand('irori.copyPath', async (element?: Element) => {
			const uri = resourceOf(index, element);
			if (uri) {
				await vscode.env.clipboard.writeText(uri.fsPath);
			}
		}),
		vscode.commands.registerCommand('irori.copyRelativePath', async (element?: Element) => {
			const uri = resourceOf(index, element);
			if (uri) {
				await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(uri, false));
			}
		})
	);

	applyLayers();
	void index.refresh();

	// SPIKE (2026-09-08): grid sidebar prototype, gated by irori.spike.enableGrid (default off).
	// The index is passed so the prototype can render the real workspace.
	registerSpikeGrid(context, index);
}

export function deactivate() {}

function resourceOf(index: WorkspaceIndex, element?: Element): vscode.Uri | undefined {
	if (!element || element.kind !== 'file') {
		return undefined;
	}
	return index.uriOf(element.file);
}
