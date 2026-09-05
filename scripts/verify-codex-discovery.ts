import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { getProviderByPath, shouldSkipSubagentPath } from "../src/providers";
import {
	isSubagentSessionPath,
	renderMarkdownFromPath,
} from "../src/providers/codex-cli";
import { readFirstLine } from "../src/providers/first-line";

function meta(id: string, parent?: string, nested = false): string {
	return JSON.stringify({
		type: "session_meta",
		payload: {
			id,
			agent_nickname: id,
			...(parent
				? nested
					? {
							source: {
								subagent: { thread_spawn: { parent_thread_id: parent } },
							},
						}
					: { parent_thread_id: parent }
				: {}),
		},
	});
}

test("bounded discovery, shared headers, and fresh parent/child traversal", () => {
	const dir = fs.mkdtempSync(join(tmpdir(), "codex-discovery-"));
	const originalRead = fs.readSync;
	const originalReadFile = fs.readFileSync;
	let bytes = 0;
	const fullReads: string[] = [];
	mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
		const count = originalRead(...args);
		bytes += count;
		return count;
	});
	mock.method(
		fs,
		"readFileSync",
		(...args: Parameters<typeof fs.readFileSync>) => {
			fullReads.push(String(args[0]));
			return originalReadFile(...args);
		},
	);
	syncBuiltinESMExports();
	try {
		const rootDir = join(dir, "sessions");
		const dated = join(rootDir, "2026", "09");
		fs.mkdirSync(dated, { recursive: true });
		const root = join(dated, "root.jsonl");
		const child = join(dated, "child.jsonl");
		const grandchild = join(rootDir, "grandchild.jsonl");
		fs.writeFileSync(root, `${meta("root")}\n`);
		fs.writeFileSync(child, `${meta("child", "root", true)}\n`);
		fs.writeFileSync(grandchild, `${meta("grandchild", "child")}\n`);
		// An unrelated 16 MiB transcript must never be read in full to index it.
		const large = join(rootDir, "large.jsonl");
		fs.writeFileSync(
			large,
			`${meta("unrelated")}\n${"x".repeat(16 * 1024 * 1024)}`,
		);
		bytes = 0;
		assert.equal(getProviderByPath(large), "codex-cli");
		assert.equal(shouldSkipSubagentPath(large), false);
		assert.equal(bytes, 4096);
		assert.equal(fullReads.length, 0);
		assert.equal(shouldSkipSubagentPath(child), true);
		const afterFilter = bytes;
		assert.equal(isSubagentSessionPath(child), true);
		assert.equal(bytes, afterFilter);
		let markdown = renderMarkdownFromPath(root);
		assert.match(markdown, /Subagent: child/);
		assert.match(markdown, /Subagent: grandchild/);
		assert.ok(!fullReads.includes(large));
		assert.ok(bytes < 16 * 1024, `Discovery read ${bytes} bytes`);

		// The next render must discover newly created children and changed parents.
		const added = join(rootDir, "added.jsonl");
		fs.writeFileSync(added, `${meta("added", "root")}\n`);
		fs.writeFileSync(child, `${meta("child", "elsewhere")}\n`);
		markdown = renderMarkdownFromPath(root);
		assert.match(markdown, /Subagent: added/);
		assert.doesNotMatch(markdown, /Subagent: child|Subagent: grandchild/);
		fs.unlinkSync(added);
		assert.doesNotMatch(renderMarkdownFromPath(root), /Subagent: added/);
		assert.equal(readFirstLine(added), null);
		fs.writeFileSync(added, `${meta("reborn")}\n`);
		assert.equal(isSubagentSessionPath(added), false);

		// Relocated files use the same header for provider and relation detection.
		const relocated = join(dir, "relocated.jsonl");
		fs.copyFileSync(grandchild, relocated);
		assert.equal(getProviderByPath(relocated), "codex-cli");
		assert.equal(shouldSkipSubagentPath(relocated), true);
		fs.renameSync(relocated, join(dir, "moved.jsonl"));
		assert.equal(getProviderByPath(relocated), undefined);

		for (const [name, content, expected] of [
			["empty", "", null],
			["blank", `\n${meta("hidden", "root")}`, null],
			["malformed", "{broken\n", "{broken"],
			["crlf", ` ${meta("crlf")} \r\nbody`, meta("crlf")],
			["no-newline", meta("eof"), meta("eof")],
			[
				"long-valid",
				`${JSON.stringify({
					type: "session_meta",
					payload: { id: "long", padding: "あ".repeat(3000) },
				})}\n`,
				undefined,
			],
			// A parseable prefix padded beyond the cap is still an oversized line.
			[
				"oversized",
				`${meta("too-long", "root") + " ".repeat(262_144)}\n`,
				null,
			],
			["oversized-eof", "x".repeat(262_145), null],
		] as const) {
			const path = join(dir, `${name}.jsonl`);
			fs.writeFileSync(path, content);
			bytes = 0;
			const line = readFirstLine(path);
			if (expected !== undefined) assert.equal(line, expected, name);
			else assert.equal(JSON.parse(line ?? "").payload.id, "long");
			assert.ok(bytes <= 262_144, name);
			assert.equal(isSubagentSessionPath(path), false, name);
			if (name.startsWith("oversized"))
				assert.equal(getProviderByPath(path), undefined);
		}
		// Atomic same-size replacement with preserved mtime still invalidates by inode.
		const replaced = join(dir, "replaced.jsonl");
		const replacement = join(dir, "replacement.jsonl");
		fs.writeFileSync(replaced, meta("before"));
		assert.equal(readFirstLine(replaced), meta("before"));
		const oldStat = fs.statSync(replaced);
		fs.writeFileSync(replacement, meta("after!"));
		fs.utimesSync(replacement, oldStat.atime, oldStat.mtime);
		fs.renameSync(replacement, replaced);
		assert.equal(readFirstLine(replaced), meta("after!"));
		fs.appendFileSync(replaced, "\nbody");
		bytes = 0;
		assert.equal(readFirstLine(replaced), meta("after!"));
		assert.ok(bytes > 0, "append invalidates header cache");

		// Reuse is bounded across long-lived library calls.
		for (let i = 0; i < 129; i++) {
			const path = join(dir, `cache-${i}.jsonl`);
			fs.writeFileSync(path, meta(String(i)));
			readFirstLine(path);
		}
		bytes = 0;
		assert.equal(readFirstLine(replaced), meta("after!"));
		assert.ok(bytes > 0, "old entries are evicted");
		for (const [name, header, provider] of [
			["claude", { type: "user" }, "claude-code"],
			["kiro", { payload: {} }, "kiro"],
		] as const) {
			const path = join(dir, `${name}.jsonl`);
			fs.writeFileSync(path, JSON.stringify(header));
			assert.equal(getProviderByPath(path), provider);
		}
		console.log(
			"16 MiB unrelated transcript: 4096 discovery bytes; no whole-file read.",
		);
	} finally {
		mock.restoreAll();
		syncBuiltinESMExports();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
