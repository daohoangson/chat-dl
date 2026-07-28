import readline from "node:readline";
import zlib from "node:zlib";
import { newBrowserPage } from "@/common";
import { minify } from "@putout/minify";

async function compressString(str: string) {
	const stream = new Blob([str])
		.stream()
		// use CompressionStream for client-side compression
		.pipeThrough(new CompressionStream("gzip"));
	const buffer = await new Response(stream).arrayBuffer();
	return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function decompressString(str: string) {
	const decoded = Buffer.from(str, "base64");
	// use zlib for server-side decompression
	const decompressed = zlib.gunzipSync(decoded);
	return decompressed.toString("utf8");
}

// The share route loads the conversation through React Router, which leaves the
// decoded payload on the client. Reading it keeps the original markdown, which
// the rendered DOM no longer has, and returns every message: the DOM only holds
// the handful of turns currently mounted.
function extractChatGPT() {
	// biome-ignore lint/suspicious/noExplicitAny: router context any
	const context = (window as any).__reactRouterContext;
	const loaderData = context?.state?.loaderData ?? {};

	let allMessages: unknown[] = [];
	// the route key embeds the share path, so look for the payload instead
	for (const route of Object.values(loaderData)) {
		// biome-ignore lint/suspicious/noExplicitAny: loader data any
		const conversation = (route as any)?.serverResponse?.data
			?.linear_conversation;
		if (!Array.isArray(conversation)) continue;

		// success 🎉
		allMessages = conversation
			// biome-ignore lint/suspicious/noExplicitAny: node any
			.map((node: any) => node?.message)
			.filter((message: unknown) => typeof message === "object");
		break;
	}

	// the enterprise fallback rewrites this line, keep it the last statement
	return allMessages;
}

function hasChatGPTConversation() {
	// biome-ignore lint/suspicious/noExplicitAny: router context any
	const context = (window as any).__reactRouterContext;
	const loaderData = context?.state?.loaderData ?? {};

	return Object.values(loaderData).some((route) =>
		// biome-ignore lint/suspicious/noExplicitAny: loader data any
		Array.isArray((route as any)?.serverResponse?.data?.linear_conversation),
	);
}

function waitForHuman(url: string): Promise<unknown[] | undefined> {
	return new Promise((resolve) => {
		if (!url.includes("://chatgpt.com/share/e/")) {
			// settle, or the caller waits on a promise nobody will ever resolve
			resolve(undefined);
			return;
		}

		let script = extractChatGPT.toString();
		script = script.replace(/^function[^{]+{/, `(() => {${compressString}`);
		script += ")();";
		script = script.replace(
			"return allMessages",
			// compress the output to reduce manual transport friction
			"compressString(JSON.stringify(allMessages)).then(console.log)",
		);

		if (script.indexOf("__name") > -1) {
			// https://github.com/evanw/esbuild/issues/2605
			script = `__name = (fn) => fn;${script}`;
		}

		script = minify(script);

		console.error(
			[
				"Looks like you are trying with an enterprise shared link. ",
				"This is not allowed, see https://help.openai.com/en/articles/8474715-chatgpt-enterprise-shared-links-faq#h_775721c4ce.\n\n",
				"There are two ways to workaround this:\n\n",
				"1. Run Chrome in debug mode and connect using `PUPPETEER_BROWSER_WS_ENDPOINT` env var.\n",
				`2. Open ${url} and execute the following code in the browser console:\n`,
				"\n",
				script,
				"\n",
			].join(""),
		);

		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stderr,
		});

		rl.question("\nThen paste the output here: ", (answer) => {
			try {
				// taking a leap of faith...
				resolve(JSON.parse(decompressString(answer)));
			} catch (e) {
				resolve(undefined);
			} finally {
				rl.close();
			}
		});
	});
}

export async function downloadFromUrl(url: string): Promise<unknown[]> {
	try {
		return await newBrowserPage(async (page) => {
			// the share page keeps retrying API calls it is not allowed to make, so
			// waiting for network idle times out: wait for the payload itself
			await page.goto(url, { waitUntil: "domcontentloaded" });

			await page.waitForFunction(hasChatGPTConversation, { timeout: 30_000 });

			// https://github.com/evanw/esbuild/issues/2605
			await page.evaluate("window.__name = (fn) => fn");

			return await page.evaluate(extractChatGPT);
		});
	} catch (e) {
		const intervention = await waitForHuman(url);
		if (Array.isArray(intervention)) {
			return intervention;
		}

		throw e;
	}
}
