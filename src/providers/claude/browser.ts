import { type CdpPage, newBrowserPage, newCdpPage } from "@/common";

export interface DownloadFromUrlOptions {
	existingChrome?: boolean;
}

function isSnapshotUrl(url: string) {
	return (
		url.includes("/chat_snapshots/") && url.includes("rendering_mode=messages")
	);
}

function parseResponseBody(body: string, base64Encoded: boolean) {
	const json = base64Encoded
		? Buffer.from(body, "base64").toString("utf8")
		: body;

	return JSON.parse(json);
}

function waitForSnapshotResponse(page: CdpPage): Promise<unknown> {
	const { client, sessionId } = page;
	const requestMethods = new Map<string, string>();
	const snapshotRequestIds = new Set<string>();

	return new Promise((resolve, reject) => {
		let done = false;

		const settle = (fn: (value: unknown) => void, value: unknown): void => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			fn(value);
		};

		const timeout = setTimeout(() => {
			settle(
				reject,
				new Error("Timed out waiting for Claude chat snapshot response"),
			);
		}, 300_000);

		client.on("Network.requestWillBeSent", (params, eventSessionId) => {
			if (eventSessionId !== sessionId) return;
			requestMethods.set(params.requestId, params.request.method);
		});

		client.on("Network.responseReceived", (params, eventSessionId) => {
			if (eventSessionId !== sessionId) return;
			if (requestMethods.get(params.requestId) !== "GET") return;
			if (!isSnapshotUrl(params.response.url)) return;

			snapshotRequestIds.add(params.requestId);
		});

		client.on("Network.loadingFinished", async (params, eventSessionId) => {
			if (eventSessionId !== sessionId) return;
			if (!snapshotRequestIds.has(params.requestId)) return;

			try {
				const responseBody = await client.send(
					"Network.getResponseBody",
					{ requestId: params.requestId },
					sessionId,
				);
				settle(
					resolve,
					parseResponseBody(responseBody.body, responseBody.base64Encoded),
				);
			} catch (error) {
				settle(reject, error);
			}
		});

		client.on("Network.loadingFailed", (params, eventSessionId) => {
			if (eventSessionId !== sessionId) return;
			if (!snapshotRequestIds.has(params.requestId)) return;

			settle(
				reject,
				new Error(`Claude chat snapshot request failed: ${params.errorText}`),
			);
		});
	});
}

async function downloadFromUrlWithPuppeteer(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		await page.goto(url, { waitUntil: "domcontentloaded" });

		const response = await page.waitForResponse(
			(response) =>
				response.request().method() === "GET" && isSnapshotUrl(response.url()),
			{ timeout: 300_000 },
		);

		return await response.json();
	});
}

async function downloadFromUrlWithExistingChrome(
	url: string,
): Promise<unknown> {
	return await newCdpPage(async (page) => {
		const { client, sessionId } = page;
		const snapshotResponse = waitForSnapshotResponse(page);

		await client.send("Network.enable", {}, sessionId);
		await client.send("Page.enable", undefined, sessionId);
		await client.send("Page.navigate", { url }, sessionId);

		return await snapshotResponse;
	});
}

export async function downloadFromUrl(
	url: string,
	options: DownloadFromUrlOptions = {},
): Promise<unknown> {
	if (options.existingChrome === true) {
		return await downloadFromUrlWithExistingChrome(url);
	}

	return await downloadFromUrlWithPuppeteer(url);
}
