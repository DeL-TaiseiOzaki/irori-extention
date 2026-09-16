/**
 * SPIKE (2026-09-08) — launcher for the grid benchmark.
 *
 * Deliberately not wired into `npm test`: it opens its own VS Code instance with
 * `out/spike/bench/runner.js` as the test entry point, so the repository's
 * integration suite (`out/test/*.test.js`) is untouched.
 *
 *   npm run compile && npm run compile-tests
 *   node out/spike/bench/launch.js
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
	// Inherited from some terminals; it makes the VS Code binary start as plain Node.
	delete process.env.ELECTRON_RUN_AS_NODE;
	const repoRoot = path.resolve(__dirname, '..', '..', '..');
	// A real vault can be pointed at with LAYEREDKB_SPIKE_WORKSPACE; the default
	// stays an empty throwaway folder so the benchmark measures only its own input.
	const workspace = process.env.LAYEREDKB_SPIKE_WORKSPACE || fs.mkdtempSync(path.join(os.tmpdir(), 'irori-spike-'));
	// A fresh, short profile path: the shared .vscode-test profile can carry a
	// broken service-worker database (which silently stops webviews from
	// loading), and a long --user-data-dir overflows the 107-char unix socket.
	const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lkb-'));
	const outPath = process.env.LAYEREDKB_SPIKE_OUT ?? path.join(repoRoot, 'out', 'spike-measurements.json');
	// `bench` measures, `shots` drives the screenshot states; both are spike-only
	// entry points and neither is reachable from `npm test`.
	const entry = process.env.LAYEREDKB_SPIKE_ENTRY === 'shots' ? 'shots.js' : 'runner.js';
	const display = process.env.LAYEREDKB_SPIKE_DISPLAY;
	if (display) {
		process.env.DISPLAY = display;
	}

	const exitCode = await runTests({
		extensionDevelopmentPath: repoRoot,
		extensionTestsPath: path.resolve(__dirname, entry),
		launchArgs: [
			`--folder-uri=${pathToFileURL(workspace).toString()}`,
			`--user-data-dir=${path.join(profile, 'ud')}`,
			`--extensions-dir=${path.join(profile, 'ext')}`,
			'--disable-workspace-trust',
			...(process.env.LAYEREDKB_SPIKE_GPU ? [] : ['--disable-gpu']),
		],
		extensionTestsEnv: {
			LAYEREDKB_SPIKE_OUT: outPath,
			LAYEREDKB_SPIKE_SIZES: process.env.LAYEREDKB_SPIKE_SIZES ?? '',
			LAYEREDKB_SPIKE_SHAPES: process.env.LAYEREDKB_SPIKE_SHAPES ?? '',
			LAYEREDKB_SPIKE_FRAMES: process.env.LAYEREDKB_SPIKE_FRAMES ?? '',
			LAYEREDKB_SPIKE_SHOTS: process.env.LAYEREDKB_SPIKE_SHOTS ?? '',
			LAYEREDKB_SPIKE_DISPLAY: display ?? '',
			LAYEREDKB_SPIKE_SCREEN: process.env.LAYEREDKB_SPIKE_SCREEN ?? '',
			LAYEREDKB_SPIKE_MODE: process.env.LAYEREDKB_SPIKE_MODE ?? '',
		},
	});
	console.log(`[spike] vscode exited with ${exitCode}; measurements at ${outPath}`);
	process.exit(exitCode);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
