import { downloadChatGPTFromUrl } from "@/chatgpt";
import { getProviderByUrl } from "@/common";
import { downloadClaudeFromUrl } from "@/claude";
import { downloadGrokFromUrl } from "@/grok";

async function downloadFromUrl(url: string) {
	const provider = getProviderByUrl(url);
	switch (provider) {
		case "chatgpt":
			return await downloadChatGPTFromUrl(url);
		case "claude":
			return await downloadClaudeFromUrl(url);
		case "grok":
			return await downloadGrokFromUrl(url);
	}

	throw new Error(`Unsupported URL: ${url}`);
}

(async () => {
	const urls = process.argv.slice(2);
	for (const url of urls) {
		const { value } = await downloadFromUrl(url);
		process.stdout.write(JSON.stringify(value));

		if (urls.length > 1) {
			process.stdout.write("\n");
		}
	}
})();
