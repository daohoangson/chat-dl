import { downloadChatGPTFromUrl } from "@/chatgpt";
import { downloadClaudeFromUrl } from "@/claude";
import { type CacheValue, getProviderByUrl } from "@/common";
import { downloadGrokFromUrl } from "@/grok";

export async function downloadFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	let cacheValue: CacheValue<unknown>;
	switch (provider) {
		case "chatgpt":
			cacheValue = await downloadChatGPTFromUrl(url);
			break;
		case "claude":
			cacheValue = await downloadClaudeFromUrl(url);
			break;
		case "grok":
			cacheValue = await downloadGrokFromUrl(url);
			break;
		default:
			throw new Error(`Unsupported URL: ${url}`);
	}

	return { provider, json: cacheValue.value };
}

(async () => {
	const urls = process.argv.slice(2);
	for (const url of urls) {
		const json = await downloadFromUrl(url);
		process.stdout.write(JSON.stringify(json));

		if (urls.length > 1) {
			process.stdout.write("\n");
		}
	}
})();
