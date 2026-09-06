import assert from "node:assert/strict";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { newBrowserPage } from "../src/common/puppeteer";

const endpointKey = "PUPPETEER_BROWSER_WS_ENDPOINT";
const originalEndpoint = process.env[endpointKey];
const originalConnect = puppeteer.connect;
const originalLaunch = puppeteer.launch;

async function check(
	endpoint: string | undefined,
	failure?: "pages" | "newPage" | "callback" | "pageClose",
	blank = true,
) {
	if (endpoint === undefined) delete process.env[endpointKey];
	else process.env[endpointKey] = endpoint;
	const calls: string[] = [];
	const error = new Error(failure);
	const existingPage = {
		url: () => (blank ? "about:blank" : "https://example.com"),
		close: async () => calls.push("existing.close"),
	} as unknown as Page;
	const newPage = {
		close: async () => {
			calls.push("page.close");
			if (failure === "pageClose") throw error;
		},
	} as unknown as Page;
	const browser = {
		pages: async () => {
			calls.push("pages");
			if (failure === "pages") throw error;
			return [existingPage];
		},
		newPage: async () => {
			calls.push("newPage");
			if (failure === "newPage") throw error;
			return newPage;
		},
		close: async () => calls.push("browser.close"),
		disconnect: async () => calls.push("disconnect"),
	} as unknown as Browser;
	puppeteer.connect = async (options) => {
		assert.equal(options.browserWSEndpoint, endpoint);
		calls.push("connect");
		return browser;
	};
	puppeteer.launch = async () => {
		calls.push("launch");
		return browser;
	};
	const result = newBrowserPage(async (page) => {
		calls.push("callback");
		assert.equal(
			page,
			endpoint !== undefined || !blank ? newPage : existingPage,
		);
		if (failure === "callback") throw error;
		return 42;
	});
	if (failure) await assert.rejects(result, (actual) => actual === error);
	else assert.equal(await result, 42);
	assert.equal(calls.includes("existing.close"), false);
	if (endpoint !== undefined) {
		assert.equal(calls.includes("launch"), false);
		assert.equal(calls.includes("pages"), false);
		assert.equal(calls.includes("browser.close"), false);
		assert.equal(calls.at(-1), "disconnect");
		assert.equal(calls.includes("page.close"), failure !== "newPage");
	} else {
		assert.equal(calls.includes("connect"), false);
		assert.equal(calls.includes("disconnect"), false);
		assert.equal(calls.at(-1), "browser.close");
	}
	if (failure === "pages" || failure === "newPage") {
		assert.equal(calls.includes("callback"), false);
	}
}

async function main() {
	try {
		for (const endpoint of [
			"ws://localhost:9222/devtools/browser/mock",
			"ws://127.0.0.1:9222/devtools/browser/mock",
			"ws://[::1]:9222/devtools/browser/mock",
			"wss://remote.example/devtools/browser/mock",
		]) {
			await check(endpoint);
			await check(endpoint, undefined, false);
			await check(endpoint, "newPage");
			await check(endpoint, "callback");
			await check(endpoint, "pageClose");
		}
		await check(undefined);
		await check(undefined, undefined, false);
		await check(undefined, "pages");
		await check(undefined, "newPage", false);
		await check(undefined, "callback");
		console.log("25 mocked browser ownership and cleanup checks passed");
	} finally {
		puppeteer.connect = originalConnect;
		puppeteer.launch = originalLaunch;
		if (originalEndpoint === undefined) delete process.env[endpointKey];
		else process.env[endpointKey] = originalEndpoint;
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
