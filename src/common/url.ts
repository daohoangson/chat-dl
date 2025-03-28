type Provider = "grok" | "chatgpt" | "claude";

export function getProviderByUrl(url: string): Provider | undefined {
	const hostname = new URL(url).hostname;
	switch (hostname) {
		case "chatgpt.com":
			if (url.includes("://chatgpt.com/share/")) {
				return "chatgpt";
			}
			break;
		case "claude.ai":
			if (url.includes("://claude.ai/share/")) {
				return "claude";
			}
			break;
		case "x.com":
			if (url.includes("://x.com/i/grok/share/")) {
				return "grok";
			}
			break;
	}

	return;
}
