import { newBrowserPage } from "@/common";

interface GrokWindow extends Window {
	$_TSR?: { router?: { matches?: { l?: { share?: unknown } }[] } };
	__chatDlGrokShare?: unknown;
}

// X's logged-out page streams the original Markdown in its router bootstrap.
// Capture it before hydration deletes the router and its inline scripts.
function captureBootstrap() {
	document.addEventListener("x-web:bootstrap-data", () => {
		const target = window as GrokWindow;
		for (const match of target.$_TSR?.router?.matches ?? []) {
			if (match.l?.share) target.__chatDlGrokShare = match.l.share;
		}
	});
}

export async function downloadFromUrl(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		await page.evaluateOnNewDocument(captureBootstrap);
		const controller = new AbortController();
		// Keep supporting the older client-rendered page, including early responses.
		const responsePromise = page.waitForResponse(
			(response) =>
				response.request().method() === "GET" &&
				response.url().includes("GrokShare"),
			{ timeout: 30_000, signal: controller.signal },
		);
		// The waiter may reject while navigation is still pending.
		responsePromise.catch(() => undefined);

		try {
			const navigation = await page.goto(url, {
				waitUntil: "domcontentloaded",
			});
			if (navigation && !navigation.ok()) {
				throw new Error(
					`Grok share navigation failed: HTTP ${navigation.status()}`,
				);
			}

			const share = await page.evaluate(
				() => (window as GrokWindow).__chatDlGrokShare,
			);
			if (share) return { data: { grokShare: share } };

			const response = await responsePromise;
			if (!response.ok()) {
				throw new Error(
					`Grok share response failed: HTTP ${response.status()}`,
				);
			}
			return await response.json();
		} finally {
			// Cancel the legacy listener on HTML success as well as on errors.
			controller.abort();
		}
	});
}
