import { newBrowserPage } from "@/common";

export async function downloadFromUrl(url: string): Promise<unknown> {
	return await newBrowserPage(async (page) => {
		await page.goto(url, { waitUntil: "domcontentloaded" });

		// Based on the plan.md, we need to intercept the API call to fetch the shared chat data
		const response = await page.waitForResponse(
			(response) =>
				response.request().method() === "GET" &&
				response.url().includes("/api/chat_snapshots/") &&
				response.url().includes("rendering_mode=messages"),
			{ timeout: 300_000 },
		);

		return await response.json();
	});
}
