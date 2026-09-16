/**
 * SPIKE (2026-09-08) — WebviewView host for the grid sidebar prototype.
 *
 * Throwaway. Registered into the existing `irori` activity-bar container
 * behind the default-off setting `irori.spike.enableGrid`, so nothing
 * changes for a user who does not opt in.
 */
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { GridModel } from './gridModel';

export const SPIKE_VIEW_ID = 'irori.spike.grid';

/** Rendering strategy under test. */
export type RenderMode = 'naive' | 'virtual';

/** Initial collapse state: mockup default (directories closed) or everything open. */
export type ExpandMode = 'default' | 'all';

/** The subset of WebviewView / WebviewPanel this prototype needs. */
export interface SpikeWebviewHost {
	readonly webview: vscode.Webview;
	readonly onDidDispose: vscode.Event<void>;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
}

const READY_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 120_000;

export class SpikeGridViewProvider implements vscode.WebviewViewProvider {
	private view: SpikeWebviewHost | undefined;
	private ready = false;
	private readonly readyWaiters: (() => void)[] = [];
	private readonly pending = new Map<number, PendingRequest>();
	private nextRequestId = 1;

	/**
	 * `inline` embeds the CSS/JS in the document instead of loading them through
	 * `asWebviewUri`. The side bar host paints either way; the editor host in a
	 * headless session only paints with the assets inlined.
	 */
	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly inline = false,
		/** Called once VS Code hands the view over, so a host can push its first model. */
		private readonly onResolved?: () => void
	) {}

	private get mediaUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, 'src', 'spike', 'media');
	}

	/** True once VS Code has handed the view over; the webview may still be loading. */
	get isResolved(): boolean {
		return this.view !== undefined;
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.attach(webviewView);
	}

	/** Host the same grid in a WebviewView or a WebviewPanel; both expose these two members. */
	attach(host: SpikeWebviewHost): void {
		this.view = host;
		this.ready = false;
		host.webview.options = { enableScripts: true, localResourceRoots: [this.mediaUri] };
		host.webview.html = this.render(host.webview);
		host.webview.onDidReceiveMessage((message) => this.onMessage(message));
		console.log('[irori spike] webview host attached');
		host.onDidDispose(() => {
			this.view = undefined;
			this.ready = false;
			this.failPending(new Error('spike webview disposed'));
		});
		this.onResolved?.();
	}

	private onMessage(message: { type?: string; requestId?: number; payload?: unknown; error?: string }): void {
		if (message.type === 'ready') {
			console.log('[irori spike] webview reported ready');
			this.ready = true;
			this.readyWaiters.splice(0).forEach((resolve) => resolve());
			return;
		}
		if (message.type === 'result' && typeof message.requestId === 'number') {
			const request = this.pending.get(message.requestId);
			this.pending.delete(message.requestId);
			if (!request) {
				return;
			}
			if (message.error) {
				request.reject(new Error(message.error));
			} else {
				request.resolve(message.payload);
			}
			return;
		}
		if (message.type === 'boot' || message.type === 'boot-error') {
			console.log(`[irori spike] ${message.type}`, JSON.stringify(message));
			return;
		}
		if (message.type === 'add' || message.type === 'open') {
			console.log(`[irori spike] ${message.type}`, message);
		}
	}

	private failPending(error: Error): void {
		for (const request of this.pending.values()) {
			request.reject(error);
		}
		this.pending.clear();
	}

	async waitForReady(): Promise<void> {
		if (this.ready) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('spike webview did not become ready')), READY_TIMEOUT_MS);
			this.readyWaiters.push(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	}

	/** Send a message and wait for the webview's matching `result`. */
	async request<T>(message: Record<string, unknown>): Promise<T> {
		const view = this.view;
		if (!view) {
			throw new Error('spike webview is not resolved; run irori.spike.openGrid first');
		}
		await this.waitForReady();
		const requestId = this.nextRequestId++;
		const promise = new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`spike webview request ${String(message.type)} timed out`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(requestId, {
				resolve: (value) => {
					clearTimeout(timer);
					resolve(value as T);
				},
				reject: (reason) => {
					clearTimeout(timer);
					reject(reason);
				},
			});
		});
		await view.webview.postMessage({ ...message, requestId });
		return promise;
	}

	async setModel(model: GridModel, mode: RenderMode, expand: ExpandMode = 'default'): Promise<unknown> {
		return this.request({ type: 'set-model', model, mode, expand });
	}

	private readAsset(name: string): string {
		return readFileSync(vscode.Uri.joinPath(this.mediaUri, name).fsPath, 'utf8');
	}

	private render(webview: vscode.Webview): string {
		const nonce = randomBytes(16).toString('hex');
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.mediaUri, 'grid.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.mediaUri, 'grid.js'));
		const csp = [
			`default-src 'none'`,
			`style-src ${webview.cspSource} 'nonce-${nonce}'`,
			`script-src 'nonce-${nonce}'`,
			`font-src ${webview.cspSource}`,
		].join('; ');
		const styleTag = this.inline
			? `<style nonce="${nonce}">${this.readAsset('grid.css')}</style>`
			: `<link href="${styleUri}" rel="stylesheet">`;
		const scriptTag = this.inline
			? `<script nonce="${nonce}">${this.readAsset('grid.js')}</script>`
			: `<script nonce="${nonce}" src="${scriptUri}"></script>`;
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	${styleTag}
	<title>irori grid (spike)</title>
</head>
<body>
	<div id="grid"></div>
	<div id="hud">spike</div>
	<script nonce="${nonce}">
		// Boot probe: tells the host that scripting works at all, so a silent
		// failure to load grid.js is distinguishable from a blocked webview.
		window.__spikeApi = acquireVsCodeApi();
		window.addEventListener('error', function (event) {
			window.__spikeApi.postMessage({ type: 'boot-error', message: String(event.message || event.type) });
		});
		window.__spikeApi.postMessage({ type: 'boot' });
	</script>
	${scriptTag}
</body>
</html>`;
	}
}
