import {
	type BigIntStats,
	closeSync,
	fstatSync,
	openSync,
	readSync,
	statSync,
} from "node:fs";
import { resolve } from "node:path";

// Bound both I/O per file and retained metadata across library calls.
const MAX_BYTES = 262_144;
const CHUNK_BYTES = 4096;
const MAX_CACHE_ENTRIES = 128;
const cache = new Map<string, { version: string; line: string | null }>();

function version(stat: BigIntStats): string {
	return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

/** Read a complete first line only; oversized lines cannot self-identify. */
export function readFirstLine(path: string): string | null {
	const key = resolve(path);
	let fd: number | undefined;
	try {
		const current = version(statSync(key, { bigint: true }));
		const cached = cache.get(key);
		if (cached?.version === current) {
			cache.delete(key);
			cache.set(key, cached);
			return cached.line;
		}
		cache.delete(key);
		fd = openSync(key, "r");
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile()) return null;
		const buffer = Buffer.alloc(
			Number(before.size < BigInt(MAX_BYTES) ? before.size : BigInt(MAX_BYTES)),
		);
		let offset = 0;
		let end = -1;
		while (offset < buffer.length) {
			const count = readSync(
				fd,
				buffer,
				offset,
				Math.min(CHUNK_BYTES, buffer.length - offset),
				offset,
			);
			if (!count) break;
			const newline = buffer.subarray(offset, offset + count).indexOf(10);
			if (newline !== -1) {
				end = offset + newline;
				break;
			}
			offset += count;
		}
		const line =
			end !== -1
				? buffer.toString("utf-8", 0, end).trim() || null
				: before.size <= MAX_BYTES && BigInt(offset) === before.size
					? buffer.toString("utf-8", 0, offset).trim() || null
					: null;
		// A concurrent append/rewrite must not seed a reusable stale entry.
		if (version(before) === version(fstatSync(fd, { bigint: true }))) {
			cache.set(key, { version: version(before), line });
			if (cache.size > MAX_CACHE_ENTRIES) {
				const oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
		}
		return line;
	} catch {
		cache.delete(key);
		return null;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
