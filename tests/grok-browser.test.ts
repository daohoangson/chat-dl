import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer";
import { renderMarkdownFromJson } from "../src/providers/grok";
import { downloadFromUrl } from "../src/providers/grok/browser";

const fixture = JSON.parse(
	readFileSync(join(__dirname, "fixtures/grok.json"), "utf8"),
);
const golden = readFileSync(
	join(__dirname, "fixtures/grok.md"),
	"utf8",
).trimEnd();

test("Grok downloads HTML bootstrap and legacy API shares", async (t) => {
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});
	const endpointKey = "PUPPETEER_BROWSER_WS_ENDPOINT";
	const previousEndpoint = process.env[endpointKey];
	process.env[endpointKey] = browser.wsEndpoint();
	t.after(async () => {
		if (previousEndpoint === undefined) delete process.env[endpointKey];
		else process.env[endpointKey] = previousEndpoint;
		await browser.close();
	});
	const tabsBefore = (await browser.pages()).length;
	const server = createServer((req, res) => {
		if (req.url?.startsWith("/api/GrokShare")) {
			res.writeHead(req.url.includes("denied") ? 403 : 200, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(fixture));
			return;
		}
		if (req.url === "/slow.js") {
			res.setHeader("Content-Type", "text/javascript");
			setTimeout(() => res.end(""), 200);
			return;
		}
		res.setHeader("Content-Type", "text/html");
		if (req.url === "/denied") {
			res.statusCode = 403;
			res.end("Access denied");
		} else if (req.url === "/html" || req.url === "/invalid") {
			const share =
				req.url === "/html" ? fixture.data.grokShare : { items: "invalid" };
			res.end(`<html><body><script>
window.$_TSR = {router: {matches: [{l: {share: ${JSON.stringify(share)}}}]}};
document.dispatchEvent(new Event('x-web:bootstrap-data'));
delete window.$_TSR;
document.currentScript.remove();
</script><p>Rendered conversation</p></body></html>`);
		} else {
			const suffix = req.url === "/api-denied" ? "?denied" : "";
			res.end(`<html><body><script>
setTimeout(() => fetch('/api/GrokShare${suffix}'), ${req.url === "/delayed" ? 400 : 0});
</script><script src="/slow.js"></script></body></html>`);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const base = `http://127.0.0.1:${address.port}`;

	for (const path of ["/html", "/early", "/delayed"]) {
		await t.test(path, async () => {
			const json = await downloadFromUrl(base + path);
			assert.deepEqual(json, fixture);
			assert.equal(renderMarkdownFromJson(json).trimEnd(), golden);
			assert.equal((await browser.pages()).length, tabsBefore);
		});
	}
	for (const [path, expected] of [
		["/denied", /navigation failed: HTTP 403/],
		["/api-denied", /response failed: HTTP 403/],
	] as const) {
		await t.test(path, { timeout: 5_000 }, async () => {
			await assert.rejects(downloadFromUrl(base + path), expected);
			assert.equal((await browser.pages()).length, tabsBefore);
		});
	}
	await t.test(
		"invalid bootstrap does not render as a successful empty export",
		async (t) => {
			t.mock.method(console, "error", () => {});
			const json = await downloadFromUrl(`${base}/invalid`);
			assert.throws(() => renderMarkdownFromJson(json));
		},
	);
});

test("Grok accepts null optional metadata from HTML bootstrap", () => {
	assert.equal(
		renderMarkdownFromJson({
			data: {
				grokShare: {
					items: [
						{
							sender: "Agent",
							message: "**Original** markdown",
							deepsearch_headers: null,
							post_ids_results: null,
							thinking_trace: null,
						},
					],
				},
			},
		}),
		"# Agent\n\n**Original** markdown",
	);
});
