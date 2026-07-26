import { newBrowserPage, newCdpPage, waitForCdpResponseBody } from "@/common";

export interface DownloadFromUrlOptions {
	existingChrome?: boolean;
}

// the batchexecute RPC that returns the shared conversation
const rpcId = "ujx1Bf";

const description = "Gemini shared conversation response";

// the RPC is issued ~1.5s after DOMContentLoaded, so a short grace period after
// the page has loaded tells a slow network apart from a renamed RPC
const responseGrace = 20_000;

// the CDP path cannot cheaply observe DOMContentLoaded, so its deadline has to
// cover the page load too
const cdpTimeout = 60_000;

function notFoundError(seconds: number) {
	return new Error(
		`Gemini did not issue the ${rpcId} batchexecute request within ${seconds}s. The share link may be unavailable, or Gemini renamed the RPC that carries the conversation.`,
	);
}

function isConversationUrl(url: string) {
	if (!url.includes("/data/batchexecute")) return false;

	const rpcIds = new URL(url).searchParams.get("rpcids");
	return rpcIds?.split(",").includes(rpcId) === true;
}

/**
 * batchexecute responses are guarded against JSON hijacking and split into
 * length-prefixed chunks, each one an array of `[rpcId, payload]` envelopes
 * whose payload is itself a JSON string.
 */
function parseBatchExecuteBody(body: string): unknown {
	for (const line of body.split("\n")) {
		if (!line.startsWith("[")) continue;

		let chunk: unknown;
		try {
			chunk = JSON.parse(line);
		} catch {
			continue;
		}
		if (!Array.isArray(chunk)) continue;

		for (const envelope of chunk) {
			if (!Array.isArray(envelope)) continue;
			if (envelope[0] !== "wrb.fr" || envelope[1] !== rpcId) continue;

			const payload = envelope[2];
			if (typeof payload !== "string") continue;

			return JSON.parse(payload);
		}
	}

	throw new Error(`No ${rpcId} payload found in the ${description}`);
}

async function downloadFromUrlWithPuppeteer(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		// start waiting first, the RPC may resolve before `goto` returns, and let
		// the grace period below own the deadline instead of Puppeteer
		const response = page
			.waitForResponse((response) => isConversationUrl(response.url()), {
				timeout: 0,
			})
			.then(async (response) => await response.text());
		// once the grace period wins nobody awaits this any more, and closing the
		// browser rejects it: keep that from surfacing as an unhandled rejection
		response.catch(() => undefined);

		await page.goto(url, { waitUntil: "domcontentloaded" });

		let graceTimeout: NodeJS.Timeout | undefined;
		const grace = new Promise<never>((_, reject) => {
			graceTimeout = setTimeout(
				() => reject(notFoundError(responseGrace / 1_000)),
				responseGrace,
			);
		});

		try {
			return parseBatchExecuteBody(await Promise.race([response, grace]));
		} finally {
			clearTimeout(graceTimeout);
		}
	});
}

async function downloadFromUrlWithExistingChrome(
	url: string,
): Promise<unknown> {
	return await newCdpPage(async (page) => {
		const { client, sessionId } = page;
		const body = waitForCdpResponseBody(page, isConversationUrl, {
			description,
			timeout: cdpTimeout,
			timeoutError: () => notFoundError(cdpTimeout / 1_000),
		});

		await client.send("Network.enable", {}, sessionId);
		await client.send("Page.enable", undefined, sessionId);
		await client.send("Page.navigate", { url }, sessionId);

		return parseBatchExecuteBody(await body);
	});
}

export async function downloadFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
): Promise<unknown> {
	return options.existingChrome === true
		? await downloadFromUrlWithExistingChrome(url)
		: await downloadFromUrlWithPuppeteer(url);
}
