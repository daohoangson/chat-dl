import { renderChatGPTFromUrl } from "@/chatgpt";
import { renderClaudeFromUrl } from "@/claude";
import { getProviderByUrl } from "@/common";
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
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i];
		if (typeof url !== "string") {
			throw new Error(`Unsupported URL: ${url}`);
		}

		if (i > 0) {
			process.stdout.write("\n\n");
		}
		const markdown = await renderFromUrl(url);
		process.stdout.write(markdown);
	}
})();
