import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const transcript = JSON.stringify({
	type: "response_item",
	payload: { type: "message", role: "user", content: "Successful export" },
});

for (const command of ["dir2md", "opencode2md"]) {
	for (const scenario of ["mixed", "success", "malformed", "filtered"]) {
		test(`${command}: ${scenario}`, () => {
			const root = mkdtempSync(join(tmpdir(), "chat-dl-bulk-"));
			try {
				const output = join(root, "output");
				const includeGood = scenario !== "malformed";
				const includeBad = scenario !== "success";
				const filtered = scenario === "filtered";
				let args: string[];
				let goodOutput: string;
				let badOutput: string;
				if (command === "dir2md") {
					const input = join(root, "input");
					mkdirSync(input);
					writeFileSync(join(input, "ignored.txt"), "unrelated");
					if (includeGood) {
						const good = join(input, "good.jsonl");
						writeFileSync(good, transcript);
						utimesSync(good, 1, 1);
					}
					if (includeBad) {
						// Valid first line identifies the provider; the next line fails parsing.
						const bad = join(input, "bad.jsonl");
						writeFileSync(bad, `${transcript}\n{malformed`);
						utimesSync(bad, 2, 2);
					}
					args = [command, input, "--output", output];
					goodOutput = join(output, "good.md");
					badOutput = join(output, "bad.md");
				} else {
					const path = join(root, "opencode.db");
					const db = new DatabaseSync(path);
					try {
						db.exec(`
							CREATE TABLE session (id TEXT, title TEXT, directory TEXT,
								parent_id TEXT, time_created INTEGER, time_updated INTEGER);
							CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
							CREATE TABLE part (id TEXT, session_id TEXT, message_id TEXT, data TEXT);
						`);
						for (const id of ["good", "bad"]) {
							if (id === "good" ? !includeGood : !includeBad) continue;
							db.prepare(
								"INSERT INTO session VALUES (?, ?, 'repo', NULL, 0, ?)",
							).run(id, id, id === "bad" ? 2 : 1);
							db.prepare("INSERT INTO message VALUES (?, ?, 0, ?)").run(
								id,
								id,
								id === "bad" ? "{malformed" : '{"role":"user"}',
							);
							db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)").run(
								id,
								id,
								id,
								'{"type":"text","text":"Successful export"}',
							);
						}
					} finally {
						db.close();
					}
					args = [command, "--database", path, "--output", output];
					goodOutput = join(output, "repo", "1970-01-01", "good.md");
					badOutput = join(output, "repo", "1970-01-01", "bad.md");
				}
				if (filtered) args.push("--match", "good");
				const result = spawnSync(
					process.execPath,
					["--import", "tsx", resolve("src/bin/chat-dl.ts"), ...args],
					{ encoding: "utf8", timeout: 30_000 },
				);
				assert.ifError(result.error);
				const diagnostic = `${result.stdout}\n${result.stderr}`;
				const failed = includeBad && !filtered;
				assert.equal(result.status, failed ? 1 : 0, diagnostic);
				const skipped = command === "dir2md" ? ", Skipped: 1" : "";
				assert.ok(
					result.stdout.includes(
						`Processed: ${includeGood ? 1 : 0}${skipped}, Errored: ${failed ? 1 : 0}, Filtered: ${filtered ? 1 : 0}`,
					),
					diagnostic,
				);
				assert.equal(existsSync(goodOutput), includeGood, diagnostic);
				assert.equal(existsSync(badOutput), false, diagnostic);
				if (includeGood)
					assert.match(readFileSync(goodOutput, "utf8"), /Successful export/);
				if (failed) assert.match(result.stderr, /✗ bad/);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}
}
