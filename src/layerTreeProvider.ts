import * as vscode from 'vscode';
import { buildTree, childrenOf, DirectoryNode, FileNode, LayerDefinition, TreeNode } from './layers';
import { WorkspaceIndex } from './workspaceIndex';

export type Element = TreeNode;

/**
 * 1 つのレイヤーを「ディレクトリ → ファイル」のツリーとして表示するプロバイダ．
 * レイヤーごとに独立したビュー（パネル）に割り当てられる．
 */
export class LayerTreeProvider implements vscode.TreeDataProvider<Element> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<Element | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private _layer: LayerDefinition | undefined;
	private _root: DirectoryNode = buildTree([], false);

	constructor(private readonly index: WorkspaceIndex) {}

	get layer(): LayerDefinition | undefined {
		return this._layer;
	}

	/** このビューが担当するレイヤーを差し替える（undefined なら空表示） */
	setLayer(layer: LayerDefinition | undefined): void {
		this._layer = layer;
		this.rebuild();
	}

	/** インデックスの最新結果からツリーを組み直す */
	rebuild(): void {
		const files = this._layer ? this.index.filesOf(this._layer.id) : [];
		this._root = buildTree(files, this.index.config.compactFolders);
		this._onDidChangeTreeData.fire(undefined);
	}

	get fileCount(): number {
		return this._layer ? this.index.filesOf(this._layer.id).length : 0;
	}

	getTreeItem(element: Element): vscode.TreeItem {
		return element.kind === 'directory' ? this.directoryItem(element) : this.fileItem(element);
	}

	getChildren(element?: Element): Element[] {
		if (!element) {
			return childrenOf(this._root);
		}
		if (element.kind === 'directory') {
			return childrenOf(element);
		}
		return [];
	}

	private directoryItem(node: DirectoryNode): vscode.TreeItem {
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
		item.tooltip = node.path;
		item.contextValue = 'irori.directory';
		// resourceUri を与えるとファイルアイコンテーマのフォルダーアイコンが使われる
		const sample = firstFile(node);
		if (sample) {
			const uri = this.index.uriOf(sample.file);
			if (uri) {
				const depth = sample.path.split('/').length - node.path.split('/').length;
				item.resourceUri = ascend(uri, depth);
			}
		}
		return item;
	}

	private fileItem(node: FileNode): vscode.TreeItem {
		const uri = this.index.uriOf(node.file);
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
		item.tooltip = uri ? uri.fsPath : node.path;
		item.contextValue = 'irori.file';
		if (uri) {
			item.resourceUri = uri;
			item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
		}
		return item;
	}
}

function firstFile(node: DirectoryNode): FileNode | undefined {
	if (node.files.length > 0) {
		return node.files[0];
	}
	for (const dir of node.directories) {
		const found = firstFile(dir);
		if (found) {
			return found;
		}
	}
	return undefined;
}

function ascend(uri: vscode.Uri, levels: number): vscode.Uri {
	let current = uri;
	for (let i = 0; i < levels; i++) {
		current = vscode.Uri.joinPath(current, '..');
	}
	return current;
}
