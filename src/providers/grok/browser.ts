import { newBrowserPage } from "@/common";

export async function downloadFromUrl(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		const controller = new AbortController();
		// Listen before navigation: the conversation can arrive before goto resolves.
		const responsePromise = page.waitForResponse(
			(response) =>
				response.request().method() === "GET" &&
				response.url().includes("GrokShare"),
			{ timeout: 300_000, signal: controller.signal },
		);
		// The waiter may reject while navigation is still pending.
		responsePromise.catch(() => undefined);

		try {
			await page.goto(url, { waitUntil: "domcontentloaded" });
			const response = await responsePromise;
			return await response.json();
		} finally {
			// Cancel the listener and its timeout even if navigation fails.
			controller.abort();
		}
	});
}
