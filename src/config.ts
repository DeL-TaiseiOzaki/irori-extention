import * as vscode from 'vscode';
import { DEFAULT_LAYERS, LayerDefinition, validateLayers } from './layers';

export const CONFIG_SECTION = 'irori';

export interface IroriConfig {
	layers: LayerDefinition[];
	exclude: string[];
	showOtherLayer: boolean;
	compactFolders: boolean;
	decorateExplorer: boolean;
}

/** 設定を読み込む．不正なレイヤー定義があれば警告し，既定値へフォールバックする． */
export function readConfig(): IroriConfig {
	const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
	let layers = cfg.get<LayerDefinition[]>('layers') ?? DEFAULT_LAYERS;
	if (!Array.isArray(layers) || layers.length === 0) {
		layers = DEFAULT_LAYERS;
	}
	const problems = validateLayers(layers);
	if (problems.length > 0) {
		void vscode.window.showWarningMessage(
			`irori: irori.layers の設定に問題があるため既定のレイヤーを使います．${problems[0]}`
		);
		layers = DEFAULT_LAYERS;
	}
	return {
		layers,
		exclude: cfg.get<string[]>('exclude') ?? [],
		showOtherLayer: cfg.get<boolean>('showOtherLayer') ?? true,
		compactFolders: cfg.get<boolean>('compactFolders') ?? true,
		decorateExplorer: cfg.get<boolean>('decorateExplorer') ?? true,
	};
}

export function affectsConfig(e: vscode.ConfigurationChangeEvent): boolean {
	return e.affectsConfiguration(CONFIG_SECTION) || e.affectsConfiguration('files.exclude');
}
