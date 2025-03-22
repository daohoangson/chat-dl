import puppeteer, { type Browser, type Page } from "puppeteer";

export async function newBrowserPage<T>(fn: (page: Page) => Promise<T>) {
	const { PUPPETEER_BROWSER_WS_ENDPOINT } = process.env;

	let browser: Browser;
	if (typeof PUPPETEER_BROWSER_WS_ENDPOINT === "string") {
		browser = await puppeteer.connect({
			browserWSEndpoint: PUPPETEER_BROWSER_WS_ENDPOINT,
		});
	} else {
		browser = await puppeteer.launch({ headless: false });
	}

	let page: Page | undefined;
	const existingPages = await browser.pages();
	if (existingPages.length === 1) {
		const existingPage = existingPages[0];
		if (existingPage?.url() === "about:blank") {
			page = existingPage;
		}
	}
	if (typeof page === "undefined") {
		page = await browser.newPage();
	}

	try {
		return await fn(page);
	} finally {
		if (
			typeof PUPPETEER_BROWSER_WS_ENDPOINT === "string" &&
			PUPPETEER_BROWSER_WS_ENDPOINT.startsWith("ws://localhost")
		) {
			// it's possible to run Chrome in debug mode
			// e.g. `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222`
			// then obtain the ws debugger URL at http://localhost:9222/json/version
			await page.close();
			await browser.disconnect();
		} else {
			await browser.close();
		}
	}
}
