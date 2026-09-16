/**
 * SPIKE (2026-09-08) — screenshot driver.
 *
 * Runs inside a real VS Code extension host (launched by `launch.js` with
 * `LAYEREDKB_SPIKE_ENTRY=shots`), puts the grid into each state we want to show,
 * and grabs the Xvfb display with ffmpeg after the webview has actually painted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'del-taiseiozaki.irori-extention';
const SETTLE_MS = 1500;
const THEME_SETTLE_MS = 2500;
const WIDEN_TARGET_PX = 760;
const WIDEN_STEPS = 80;
const PANEL_SETTLE_MS = 4000;
const DEFAULT_SIDEBAR_PX = 320;

interface LayoutProbe {
	sidebarPx?: string;
	panes?: string[];
	gridTemplateColumns?: string;
	bodyClass?: string;
}

export async function run(): Promise<void> {
	const outDir = prepare();
	if (process.env.LAYEREDKB_SPIKE_MODE === 'real') {
		return runReal(outDir);
	}

	const report: Record<string, unknown> = {};
	const synthetic = { fileCount: 3000, depth: 2, branching: 6, expand: 'all' as const };

	await quiet();
	await setTheme('Default Dark Modern');
	await vscode.commands.executeCommand('irori.spike.loadSynthetic', synthetic);
	// The real design gives the grid its own container; here the eight shipped
	// tree slots share it, so hide them to reproduce that geometry.
	report['hiddenSlots'] = await hideTreeSlots();
	await delay(SETTLE_MS);
	report['grid-default-dark'] = await shoot(outDir, 'grid-default-dark.png');

	await setTheme('Default Light Modern');
	await delay(SETTLE_MS);
	report['grid-default-light'] = await shoot(outDir, 'grid-default-light.png');

	await setTheme('Default Dark Modern');
	await delay(SETTLE_MS);
	report['widen'] = await widenSideBar();
	await delay(SETTLE_MS);
	report['grid-wide-dark'] = await shoot(outDir, 'grid-wide-dark.png');

	await resetSideBar((report['widen'] as { command?: string })?.command);
	await vscode.commands.executeCommand('irori.spike.openGridPanel', synthetic);
	await delay(PANEL_SETTLE_MS);
	await delay(PANEL_SETTLE_MS);
	report['grid-editor-or-panel'] = await shoot(outDir, 'grid-editor-or-panel.png');

	fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(`[spike] screenshots written to ${outDir}`);
}

function prepare(): string {
	const outDir = process.env.LAYEREDKB_SPIKE_SHOTS;
	if (!outDir) {
		throw new Error('LAYEREDKB_SPIKE_SHOTS is not set');
	}
	fs.mkdirSync(outDir, { recursive: true });
	return outDir;
}

/**
 * The real vault: the same states, fed by `WorkspaceIndex` instead of the
 * generator. Run it with LAYEREDKB_SPIKE_WORKSPACE pointing at a vault.
 */
async function runReal(outDir: string): Promise<void> {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(`extension ${EXTENSION_ID} not found`);
	}
	await extension.activate();

	const report: Record<string, unknown> = {};
	report['folders'] = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
	await quiet();
	await setTheme('Default Dark Modern');
	// Load first, hide second: loading rescans, and a rescan makes `applyLayers`
	// re-assert every slot's visibility context, which would undo the hiding.
	await vscode.commands.executeCommand('irori.spike.loadWorkspace', { expand: 'all' });
	report['hiddenSlots'] = await hideTreeSlots();
	// The contents pane is taller than the side bar; fold the mounts shut and
	// scroll them into view, since they are what this shot has to show.
	report['scrolled'] = await vscode.commands.executeCommand('irori.spike.focusMounts');
	await delay(SETTLE_MS);
	report['real-default-dark'] = await shoot(outDir, 'real-default-dark.png');

	report['widen'] = await widenSideBar();
	await vscode.commands.executeCommand('irori.spike.focusMounts');
	await delay(SETTLE_MS);
	report['real-wide-dark'] = await shoot(outDir, 'real-wide-dark.png');

	fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(`[spike] real-vault screenshots written to ${outDir}`);
}

async function shoot(outDir: string, name: string): Promise<Record<string, unknown>> {
	const target = path.join(outDir, name);
	const display = process.env.LAYEREDKB_SPIKE_DISPLAY ?? ':99';
	const size = process.env.LAYEREDKB_SPIKE_SCREEN ?? '1600x1000';
	execFileSync(
		'ffmpeg',
		['-loglevel', 'error', '-f', 'x11grab', '-video_size', size, '-i', display, '-frames:v', '1', '-y', target],
		{ stdio: 'inherit' }
	);
	const probe = (await vscode.commands.executeCommand('irori.spike.probe')) as LayoutProbe;
	console.log(`[spike] captured ${name} bytes=${fs.statSync(target).size} sidebar=${probe?.sidebarPx}`);
	return { file: target, bytes: fs.statSync(target).size, probe };
}

/** Close the chat side bar and notifications so they do not cover the shot. */
async function quiet(): Promise<void> {
	for (const command of ['workbench.action.closeAuxiliaryBar', 'notifications.clearAll']) {
		try {
			await vscode.commands.executeCommand(command);
		} catch (error) {
			console.log(`[spike] ${command} unavailable: ${String(error)}`);
		}
	}
}

/** Hide the eight shipped tree slots so the grid owns the side bar. */
async function hideTreeSlots(): Promise<string[]> {
	const hidden: string[] = [];
	for (let slot = 0; slot < 8; slot++) {
		const command = `irori.slot${slot}.removeView`;
		try {
			await vscode.commands.executeCommand(command);
			hidden.push(command);
		} catch {
			// Not every VS Code build exposes removeView; the fallback below covers it.
		}
	}
	if (hidden.length === 0) {
		const layered = vscode.workspace.getConfiguration('irori');
		await layered.update('layers', [{ id: 'solo', label: 'Solo', patterns: ['zzz/**'] }], vscode.ConfigurationTarget.Global);
		await layered.update('showOtherLayer', false, vscode.ConfigurationTarget.Global);
		hidden.push('fallback:single-layer-config');
	}
	await delay(SETTLE_MS);
	return hidden;
}

/**
 * VS Code has no "set side bar width" API and the sign of the resize commands
 * depends on which part has focus, so pick the command that measurably grows
 * the side bar instead of assuming one.
 */
async function widenSideBar(): Promise<Record<string, unknown>> {
	await vscode.commands.executeCommand('workbench.action.focusSideBar');
	const available = await vscode.commands.getCommands(true);
	const candidates = [
		'workbench.action.increaseViewWidth',
		'workbench.action.decreaseViewWidth',
		'workbench.action.increaseViewSize',
		'workbench.action.decreaseViewSize',
	].filter((command) => available.includes(command));

	const before = await sideBarWidth();
	let chosen: string | undefined;
	for (const command of candidates) {
		const start = await sideBarWidth();
		await vscode.commands.executeCommand(command);
		await delay(80);
		if ((await sideBarWidth()) > start) {
			chosen = command;
			break;
		}
	}
	if (!chosen) {
		console.log('[spike] no command widened the side bar');
		return { command: null, before, after: await sideBarWidth() };
	}
	let width = await sideBarWidth();
	for (let step = 0; step < WIDEN_STEPS && width < WIDEN_TARGET_PX; step++) {
		await vscode.commands.executeCommand(chosen);
		await delay(40);
		const next = await sideBarWidth();
		if (next <= width) {
			break;
		}
		width = next;
	}
	console.log(`[spike] side bar ${before}px -> ${width}px via ${chosen}`);
	return { command: chosen, before, after: width };
}

/** Undo the widening so the editor area has room for the panel shot. */
async function resetSideBar(widenCommand?: string): Promise<number> {
	const inverse: Record<string, string> = {
		'workbench.action.increaseViewWidth': 'workbench.action.decreaseViewWidth',
		'workbench.action.decreaseViewWidth': 'workbench.action.increaseViewWidth',
		'workbench.action.increaseViewSize': 'workbench.action.decreaseViewSize',
		'workbench.action.decreaseViewSize': 'workbench.action.increaseViewSize',
	};
	const command = widenCommand ? inverse[widenCommand] : undefined;
	if (!command) {
		return sideBarWidth();
	}
	await vscode.commands.executeCommand('workbench.action.focusSideBar');
	let width = await sideBarWidth();
	for (let step = 0; step < WIDEN_STEPS && width > DEFAULT_SIDEBAR_PX; step++) {
		await vscode.commands.executeCommand(command);
		await delay(40);
		const next = await sideBarWidth();
		if (next >= width) {
			break;
		}
		width = next;
	}
	console.log(`[spike] side bar reset to ${width}px via ${command}`);
	return width;
}

async function sideBarWidth(): Promise<number> {
	const probe = (await vscode.commands.executeCommand('irori.spike.probe')) as LayoutProbe;
	return Number(String(probe?.sidebarPx ?? '0x0').split('x')[0]) || 0;
}

async function setTheme(theme: string): Promise<void> {
	await vscode.workspace
		.getConfiguration('workbench')
		.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
	await delay(THEME_SETTLE_MS);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
