import * as vscode from 'vscode';
import { OTHER_LAYER_ID } from './layers';
import { WorkspaceIndex } from './workspaceIndex';

/**
 * 標準エクスプローラー上のファイルにレイヤーのバッジと色を付ける．
 * これにより通常のエクスプローラー表示でも各ファイルがどの層に属するかが分かる．
 */
export class ExplorerDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this._onDidChange.event;
	private readonly _disposables: vscode.Disposable[] = [];

	constructor(private readonly index: WorkspaceIndex) {
		this._disposables.push(
			this._onDidChange,
			vscode.window.registerFileDecorationProvider(this),
			index.onDidChange(() => this._onDidChange.fire(undefined))
		);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (!this.index.config.decorateExplorer) {
			return undefined;
		}
		const layerId = this.index.layerOf(uri);
		if (!layerId || layerId === OTHER_LAYER_ID) {
			return undefined;
		}
		const layer = this.index.config.layers.find((l) => l.id === layerId);
		if (!layer || (!layer.badge && !layer.color)) {
			return undefined;
		}
		const decoration = new vscode.FileDecoration(
			layer.badge ? layer.badge.slice(0, 2) : undefined,
			`irori: ${layer.label}`,
			layer.color ? new vscode.ThemeColor(layer.color) : undefined
		);
		decoration.propagate = false;
		return decoration;
	}

	dispose(): void {
		vscode.Disposable.from(...this._disposables).dispose();
	}
}
