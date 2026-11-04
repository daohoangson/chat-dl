import { randomUUID } from "node:crypto";
import { lintSource } from "@secretlint/core";
import { rules } from "@secretlint/secretlint-rule-preset-recommend";

export type ProtectedBlock = "human message" | "tool output";
export type ProtectText = (
	text: string,
	kind: ProtectedBlock,
	scanText?: string,
) => string;

// Ignore directives in transcripts must not disable scanning. AWS identifiers
// are disabled in the upstream preset by default.
const configuredRules = rules
	.filter(
		(rule) => rule.meta.id !== "@secretlint/secretlint-rule-filter-comments",
	)
	.map((rule) => ({
		id: rule.meta.id,
		rule,
		options:
			rule.meta.id === "@secretlint/secretlint-rule-aws"
				? { enableIDScanRule: true }
				: {},
	}));

const genericRules: [string, RegExp][] = [
	[
		"authorization header",
		/\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[^\s"'`,;]{8,}/i,
	],
	[
		"credential assignment",
		/\b(?:password|passwd|pwd|api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key)\b["']?\s*[:=]\s*["']?[^\s"'`,;&]{8,}/i,
	],
	[
		"credential URL parameter",
		/[?&](?:password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|secret)=[^\s&#]{8,}/i,
	],
];

export class SecretRedactor {
	private readonly id = randomUUID();
	private readonly blocks: {
		text: string;
		scanText: string;
		kind: ProtectedBlock;
	}[] = [];

	readonly protect: ProtectText = (text, kind, scanText = text) => {
		if (!text) return text;
		const index = this.blocks.push({ text, scanText, kind }) - 1;
		return `CHATDL_SECRET_BLOCK_${this.id}_${index}_END`;
	};

	async finish(markdown: string): Promise<string> {
		const replacements: string[] = [];
		for (const [index, block] of this.blocks.entries()) {
			const findings = await lintSource({
				source: {
					contentType: "text",
					content: block.scanText,
					filePath: "transcript.txt",
					ext: ".txt",
				},
				options: {
					maskSecrets: true,
					noPhysicFilePath: true,
					config: { rules: configuredRules },
				},
			});
			const labels = new Set(
				findings.messages
					.filter((item) => item.type === "message")
					.map((item) =>
						item.ruleId.replace("@secretlint/secretlint-rule-", ""),
					),
			);
			for (const [label, pattern] of genericRules)
				if (pattern.test(block.scanText)) labels.add(label);
			const replacement = labels.size
				? `[${block.kind === "human message" ? "Message" : "Output"} redacted: possible ${[...labels].join(", ")} credential]`
				: block.text;
			replacements[index] = replacement;
		}
		const pattern = new RegExp(
			`CHATDL_SECRET_BLOCK_${this.id}_(\\d+)_END`,
			"g",
		);
		return markdown.replace(
			pattern,
			(marker, index: string) => replacements[Number(index)] ?? marker,
		);
	}
}
