import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import {
	createCodexSessionDiscoveryContext,
	getProviderByPath,
	renderMarkdownFromPath,
	shouldSkipSubagentPath,
} from "../src/providers";
import {
	isSubagentSessionPath,
	renderMarkdownFromPath as renderCodexMarkdownFromPath,
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

test("a shared discovery context reuses one tree walk across an export, and each export gets fresh discovery", () => {
	const dir = fs.mkdtempSync(join(tmpdir(), "codex-discovery-shared-"));
	const originalRead = fs.readSync;
	let readCalls = 0;
	mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
		const count = originalRead(...args);
		if (count > 0) readCalls++;
		return count;
	});
	syncBuiltinESMExports();
	try {
		const rootDir = join(dir, "sessions");
		fs.mkdirSync(rootDir, { recursive: true });

		const STANDALONE_COUNT = 150; // exceeds the 128-entry first-line cache
		for (let i = 0; i < STANDALONE_COUNT; i++) {
			fs.writeFileSync(
				join(rootDir, `standalone-${i}.jsonl`),
				`${meta(`standalone-${i}`)}\n`,
			);
		}
		const roots = ["root-a", "root-b", "root-c"];
		for (const rootId of roots) {
			fs.writeFileSync(join(rootDir, `${rootId}.jsonl`), `${meta(rootId)}\n`);
			for (let c = 0; c < 2; c++) {
				fs.writeFileSync(
					join(rootDir, `${rootId}-child-${c}.jsonl`),
					`${meta(`${rootId}-child-${c}`, rootId)}\n`,
				);
			}
		}
		const totalFiles = STANDALONE_COUNT + roots.length * 3;

		const exportContext = createCodexSessionDiscoveryContext();

		// Discovery phase: filter every candidate once, as dir2md's collectCandidates does.
		// Using the context-aware entry point directly isolates this metric from the
		// unrelated, already-bounded first-line cache that plain path-based provider
		// detection also relies on.
		readCalls = 0;
		for (const name of fs.readdirSync(rootDir)) {
			isSubagentSessionPath(join(rootDir, name), exportContext);
		}
		assert.equal(
			readCalls,
			totalFiles,
			"discovery must build the index with exactly one tree walk",
		);

		// Rendering every selected root candidate must reuse that same index.
		for (const rootId of roots) {
			const markdown = renderCodexMarkdownFromPath(
				join(rootDir, `${rootId}.jsonl`),
				exportContext,
			);
			assert.match(markdown, new RegExp(`Subagent: ${rootId}-child-0`));
			assert.match(markdown, new RegExp(`Subagent: ${rootId}-child-1`));
		}
		assert.equal(
			readCalls,
			totalFiles,
			"rendering additional candidates through a shared context must not re-walk or re-read the tree",
		);

		// A file added mid-export is invisible to that export's snapshot...
		fs.writeFileSync(
			join(rootDir, "root-a-child-2.jsonl"),
			`${meta("root-a-child-2", "root-a")}\n`,
		);
		const staleMarkdown = renderCodexMarkdownFromPath(
			join(rootDir, "root-a.jsonl"),
			exportContext,
		);
		assert.doesNotMatch(staleMarkdown, /Subagent: root-a-child-2/);
		assert.equal(
			readCalls,
			totalFiles,
			"reusing a context must not trigger another tree walk even when files changed",
		);

		// ...but the next export (a fresh context) sees it. The newly written
		// file was never read by anything before, so a fresh walk must cost at
		// least one more read than the shared context ever did (which stayed
		// flat at exactly `totalFiles`, asserted above).
		const freshContext = createCodexSessionDiscoveryContext();
		const freshMarkdown = renderCodexMarkdownFromPath(
			join(rootDir, "root-a.jsonl"),
			freshContext,
		);
		assert.match(freshMarkdown, /Subagent: root-a-child-2/);
		assert.ok(
			readCalls > totalFiles,
			"a fresh context re-discovers the tree instead of reusing the prior context's index",
		);

		// Baseline: without a shared context, each render independently rebuilds
		// the index. The tree now has totalFiles + 1 files, which exceeds the
		// 128-entry first-line cache, so at least (totalFiles + 1 - 128) of those
		// reads must be genuine misses every single time -- unlike a shared
		// context, whose repeat lookups above cost exactly zero reads.
		const currentFileCount = totalFiles + 1;
		const minGenuineRereads = currentFileCount - 128;
		readCalls = 0;
		renderCodexMarkdownFromPath(join(rootDir, "root-b.jsonl"));
		const firstUnsharedRender = readCalls;
		readCalls = 0;
		renderCodexMarkdownFromPath(join(rootDir, "root-c.jsonl"));
		const secondUnsharedRender = readCalls;
		assert.ok(
			firstUnsharedRender >= minGenuineRereads,
			`each unshared render should independently re-walk the tree (got ${firstUnsharedRender})`,
		);
		assert.ok(
			secondUnsharedRender >= minGenuineRereads,
			`each unshared render should independently re-walk the tree (got ${secondUnsharedRender})`,
		);
	} finally {
		mock.restoreAll();
		syncBuiltinESMExports();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
