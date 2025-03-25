import { newBrowserPage } from "@/common";

export async function downloadFromUrl(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		await page.goto(url, { waitUntil: "domcontentloaded" });

		const response = await page.waitForResponse(
			(response) =>
				response.request().method() === "GET" &&
				response.url().includes("GrokShare"),
			{ timeout: 300_000 },
		);

		return await response.json();
	});
}
