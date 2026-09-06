import puppeteer, { type Browser, type Page } from "puppeteer";

export async function newBrowserPage<T>(fn: (page: Page) => Promise<T>) {
	const {
		PUPPETEER_BROWSER_WS_ENDPOINT,
		PUPPETEER_HEADLESS,
		PUPPETEER_NO_SANDBOX,
	} = process.env;

	const borrowed = typeof PUPPETEER_BROWSER_WS_ENDPOINT === "string";
	let browser: Browser;
	if (borrowed) {
		browser = await puppeteer.connect({
			browserWSEndpoint: PUPPETEER_BROWSER_WS_ENDPOINT,
		});
	} else {
		browser = await puppeteer.launch({
			headless: PUPPETEER_HEADLESS === "true",
			args:
				PUPPETEER_NO_SANDBOX === "true"
					? ["--no-sandbox", "--disable-setuid-sandbox"]
					: [],
		});
	}

	let page: Page | undefined;
	try {
		// Borrowed tabs belong to the user, including blank tabs.
		if (!borrowed) {
			const existingPages = await browser.pages();
			if (existingPages.length === 1) {
				const existingPage = existingPages[0];
				if (existingPage?.url() === "about:blank") {
					page = existingPage;
				}
			}
		}
		if (typeof page === "undefined") {
			page = await browser.newPage();
		}

		return await fn(page);
	} finally {
		if (borrowed) {
			try {
				await page?.close();
			} finally {
				await browser.disconnect();
			}
		} else {
			await browser.close();
		}
	}
}
