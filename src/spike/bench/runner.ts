/**
 * SPIKE (2026-09-08) — `extensionTestsPath` entry point for the benchmark.
 *
 * Runs inside a real VS Code extension host launched by
 * `out/spike/bench/launch.js`, drives `irori.spike.runBench`, and writes the
 * raw measurements to the path in `LAYEREDKB_SPIKE_OUT`.
 */
import * as fs from 'fs';
import * as vscode from 'vscode';
import { BenchRequest } from './benchmark';

const EXTENSION_ID = 'del-taiseiozaki.irori-extention';

export async function run(): Promise<void> {
	const outPath = process.env.LAYEREDKB_SPIKE_OUT;
	if (!outPath) {
		throw new Error('LAYEREDKB_SPIKE_OUT is not set');
	}
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(`extension ${EXTENSION_ID} not found`);
	}
	await extension.activate();

	const request: Partial<BenchRequest> = {
		sizes: parseSizes(process.env.LAYEREDKB_SPIKE_SIZES) ?? [1000, 10000, 20000],
		shapes: (process.env.LAYEREDKB_SPIKE_SHAPES?.split(',') as BenchRequest['shapes']) ?? ['deep'],
		modes: (process.env.LAYEREDKB_SPIKE_MODES?.split(',').filter(Boolean) as BenchRequest['modes']) ?? ['naive', 'virtual'],
		scrollFrames: Number(process.env.LAYEREDKB_SPIKE_FRAMES ?? 60),
	};

	const result = await vscode.commands.executeCommand('irori.spike.runBench', request);
	if (process.env.LAYEREDKB_SPIKE_SOLO) {
		// Shrink the shipped tree slots to one so the grid gets a realistic share
		// of the sidebar; the real design would leave it alone in its container.
		const layered = vscode.workspace.getConfiguration('irori');
		await layered.update('layers', [{ id: 'solo', label: 'Solo', patterns: ['**/*'] }], vscode.ConfigurationTarget.Global);
		await layered.update('showOtherLayer', false, vscode.ConfigurationTarget.Global);
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	const themes = process.env.LAYEREDKB_SPIKE_THEMES
		? await vscode.commands.executeCommand('irori.spike.probeThemes')
		: undefined;
	fs.writeFileSync(outPath, JSON.stringify({ ...(result as object), themes }, null, 2), 'utf8');
	console.log(`[spike] measurements written to ${outPath}`);
}

function parseSizes(raw: string | undefined): number[] | undefined {
	if (!raw) {
		return undefined;
	}
	const sizes = raw
		.split(',')
		.map((part) => Number(part.trim()))
		.filter((size) => Number.isFinite(size) && size > 0);
	return sizes.length > 0 ? sizes : undefined;
}
