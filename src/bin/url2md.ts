import { renderChatGPTFromUrl } from "@/chatgpt";
import { getProviderByUrl } from "@/common";
import { renderClaudeFromUrl } from "@/claude";
import { renderGrokFromUrl } from "@/grok";

async function renderFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	switch (provider) {
		case "chatgpt":
			return await renderChatGPTFromUrl(url);
		case "claude":
			return await renderClaudeFromUrl(url);
		case "grok":
			return await renderGrokFromUrl(url);
	}

	throw new Error(`Unsupported URL: ${url}`);
}

(async () => {
	const urls = process.argv.slice(2);
	for (const url of urls) {
		const markdown = await renderFromUrl(url);
		process.stdout.write(markdown);

		if (urls.length > 1) {
			process.stdout.write("\n\n");
		}
	}
})();
