import puppeteer, { Browser, Page } from "puppeteer";

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

  const page = await browser.newPage();

  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}
