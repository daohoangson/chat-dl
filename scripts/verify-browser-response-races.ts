import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInThisContext } from "node:vm";
import { transformSync } from "esbuild";
import type { HTTPResponse, Page } from "puppeteer";

// Substitute only the browser boundary; execute each provider's real code.
function loadProvider(provider: string, page: Partial<Page>) {
	const filename = resolve(`src/providers/${provider}/browser.ts`);
	const source = transformSync(readFileSync(filename, "utf8"), {
		loader: "ts",
		format: "cjs",
	}).code;
	const require = createRequire(filename);
	const module = {
		exports: {} as { downloadFromUrl(url: string): Promise<unknown> },
	};
	runInThisContext(`(function(require, module, exports) {${source}\n})`, {
		filename,
	})(
		(id: string) =>
			id === "@/common"
				? { newBrowserPage: (fn: (page: Partial<Page>) => unknown) => fn(page) }
				: require(id),
		module,
		module.exports,
	);
	return module.exports.downloadFromUrl;
}

async function verify(provider: string, responseUrl: string) {
	for (const scenario of [
		"early-response",
		"navigation-failure",
		"early-rejection",
	]) {
		let listener: ((response: HTTPResponse) => void) | undefined;
		let active = false;
		let aborted = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const navigationError = new Error("navigation failed");
		const responseError = new Error("response wait failed");
		const payload = { conversation: provider };
		const response = (method: string, url: string) =>
			({
				request: () => ({ method: () => method }),
				url: () => url,
				json: async () => payload,
			}) as HTTPResponse;
		const page: Partial<Page> = {
			waitForResponse: (predicate, options) => {
				assert.equal(options?.timeout, 300_000);
				assert.ok(options.signal);
				assert.equal(typeof predicate, "function");
				active = true;
				return new Promise<HTTPResponse>((resolve, reject) => {
					const cleanup = () => {
						active = false;
						clearTimeout(timer);
						listener = undefined;
					};
					timer = setTimeout(() => {
						cleanup();
						reject(responseError);
					}, 300_000);
					options.signal?.addEventListener(
						"abort",
						() => {
							aborted = true;
							cleanup();
							reject(new Error("aborted"));
						},
						{ once: true },
					);
					listener = (value) => {
						if (typeof predicate === "function" && predicate(value)) {
							cleanup();
							resolve(value);
						}
					};
					if (scenario === "early-rejection") {
						cleanup();
						reject(responseError);
					}
				});
			},
			goto: async () => {
				if (scenario !== "early-rejection")
					assert.ok(active, "waiter must precede goto");
				if (scenario === "navigation-failure") throw navigationError;
				if (scenario === "early-response") {
					listener?.(response("POST", responseUrl));
					assert.ok(active, "ignore non-GET responses");
					listener?.(response("GET", "https://example.com/unrelated"));
					assert.ok(active, "ignore unrelated responses");
					listener?.(response("GET", responseUrl));
					assert.equal(active, false, "response resolves before navigation");
				}
				// Allow unhandled rejections to surface before navigation completes.
				await new Promise((resolve) => setImmediate(resolve));
				return null;
			},
		};
		try {
			const download = loadProvider(provider, page);
			if (scenario === "early-response") {
				assert.deepEqual(await download("https://example.com/share"), payload);
			} else {
				await assert.rejects(
					download("https://example.com/share"),
					(error) =>
						error ===
						(scenario === "navigation-failure"
							? navigationError
							: responseError),
				);
			}
			await new Promise((resolve) => setImmediate(resolve));
			assert.ok(aborted, "waiter must be cancelled on exit");
			assert.equal(active, false, "no pending response listener or timeout");
			console.log(`PASS ${provider}: ${scenario}`);
		} finally {
			clearTimeout(timer);
		}
	}
}

async function main() {
	await verify(
		"claude",
		"https://claude.ai/api/chat_snapshots/id?rendering_mode=messages",
	);
	await verify("grok", "https://grok.com/api/GrokShare?id=123");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
