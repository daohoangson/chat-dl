import type { AgentResultTweet, Item } from "./models";

export function renderFromItems(items: Item[]): string {
	const markdown = [];

	for (const item of items) {
		markdown.push(`# ${item.sender}`);

		if (item.sender === "Agent") {
			const deepsearchHeaders = item.deepsearch_headers ?? [];
			if (deepsearchHeaders.length > 0) {
				markdown.push("<details><summary>Deep Search</summary>");
				for (const deepsearch of deepsearchHeaders) {
					markdown.push(
						`### ${deepsearch.header}\n\n${deepsearch.steps
							.map(({ assistant, summary, web_results }, i) => {
								let step = summary ?? assistant;
								if (web_results) {
									step += `\n\n#### Web results:\n\n${web_results
										.map(({ snippet, title, url }) => {
											const hostname = new URL(url).hostname;
											return `- **${title}**: ${
												snippet ?? ""
											} [${hostname}](${url})`;
										})
										.join("\n")}\n\n`;
								}

								return `<details><summary>Step ${
									i + 1
								}</summary>\n\n${step}\n\n</details>\n`;
							})
							.join("\n")}\n`,
					);
				}
				markdown.push("</details>");
			}

			const postIdsResults = item.post_ids_results ?? [];
			if (postIdsResults.length > 0) {
				markdown.push("<details><summary>Relevant Posts</summary>");
				type Tweet = Pick<AgentResultTweet, "core" | "legacy">;
				const getTweet = (i: number, tweet: Tweet) => {
					const { name } = tweet.core.user_results.result.legacy;
					const { full_text, id_str, user_id_str } = tweet.legacy;
					return `#### Post #${
						i + 1
					} by [@${name}](https://x.com/${user_id_str}/status/${id_str})\n\n${full_text}`;
				};
				for (let i = 0; i < postIdsResults.length; i++) {
					const { result } = postIdsResults[i] ?? {};
					if (typeof result === "undefined") continue;

					switch (result.__typename) {
						case "Tweet":
							markdown.push(getTweet(i, result));
							break;
						case "TweetWithVisibilityResults":
							markdown.push(getTweet(i, result.tweet));
							break;
					}
				}
				markdown.push("</details>");
			}

			const thinkingTrace = item.thinking_trace ?? "";
			if (thinkingTrace.length > 0) {
				markdown.push(
					`<details><summary>Thinking Trace</summary>\n\n${thinkingTrace}\n\n</details>`,
				);
			}
		}

		markdown.push(item.message);
	}

	return markdown.join("\n\n");
}
