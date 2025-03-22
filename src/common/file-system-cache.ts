import { Cache } from "file-system-cache";

const cacheInstance = new Cache({ ttl: 86400 });

export interface CacheValue<T> {
	value: T;
	cacheStatus: "HIT" | "MISS";
}

export async function cache<T>(
	key: string,
	fn: () => Promise<T>,
): Promise<CacheValue<T>> {
	const value = await cacheInstance.get(key);
	if (typeof value !== "undefined") {
		return { value, cacheStatus: "HIT" };
	}

	const newValue = await fn();
	await cacheInstance.set(key, newValue);
	return { value: newValue, cacheStatus: "MISS" };
}
