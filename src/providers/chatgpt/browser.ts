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

function extractChatGPT() {
	const extractRecursively = (f1s: unknown[]): unknown[] | undefined => {
		for (const f1 of f1s) {
			if (typeof f1 !== "object" || f1 === null) continue;
			// biome-ignore lint/suspicious/noExplicitAny: props any
			const { allMessages: f1Messages, children } = (f1 as { props: any })
				.props;

			// success 🎉
			if (Array.isArray(f1Messages)) return f1Messages;

			if (!children) continue;
			const f2s = Array.isArray(children) ? children : [children];
			const f2Messages = extractRecursively(f2s);
			if ((f2Messages?.length ?? 0) > 0) return f2Messages;
		}

		return;
	};

	const allMessages: unknown[] = [];
	const extractFromReact = (dom: HTMLElement): void => {
		const prefix = "__reactFiber$";
		type Key = keyof typeof dom | undefined;
		const key = Object.keys(dom).find((k) => k.startsWith(prefix)) as Key;
		if (key) {
			// biome-ignore lint/suspicious/noExplicitAny: fiber any
			const fiber = dom[key] as any;
			const messages = extractRecursively(fiber.memoizedProps.children);
			if (Array.isArray(messages)) allMessages.push(...messages);
		}
	};

	const articles = [];
	articles.push(...document.getElementsByTagName("article"));
	articles.forEach(extractFromReact);

	return allMessages;
}

function waitForHuman(url: string): Promise<unknown[] | undefined> {
	return new Promise((resolve) => {
		if (!url.includes("://chatgpt.com/share/e/")) {
			return undefined;
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
			await page.goto(url, { waitUntil: "networkidle0" });

			await page.waitForSelector("article", { timeout: 3_000 });

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
