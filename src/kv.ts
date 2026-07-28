import type { QueuePriority, SyncStatus } from "./types.ts";

/** KV 状态/队列管理 使用 FIFO 数组队列存储待同步的版本 ID，按优先级分三个队列。 */

// ── 队列操作 ────────────────────────────────────────────

const QUEUE_PREFIX = "sync:queue:";
const KNOWN_VERSIONS_KEY = "known:versions";
const VERSION_MANIFEST_ETAG_KEY = "version_manifest:etag";
const VERSION_MANIFEST_BODY_KEY = "version_manifest:body";

function queue_key(priority: QueuePriority): string {
  return QUEUE_PREFIX + priority;
}

function status_key(version_id: string): string {
  return `sync:status:${version_id}`;
}

export async function push_to_queue(
  kv: KVNamespace,
  priority: QueuePriority,
  version_id: string,
): Promise<void> {
  const key = queue_key(priority);
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  if (!queue.includes(version_id)) {
    queue.push(version_id);
    await kv.put(key, JSON.stringify(queue));
  }
}

export async function pop_from_queue(
  kv: KVNamespace,
  priority: QueuePriority,
): Promise<string | null> {
  const key = queue_key(priority);
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  if (queue.length === 0) return null;
  const item = queue.shift()!;
  await kv.put(key, JSON.stringify(queue));
  return item;
}

export async function queue_length(kv: KVNamespace, priority: QueuePriority): Promise<number> {
  const queue: string[] = (await kv.get(queue_key(priority), "json")) ?? [];
  return queue.length;
}

// ── 同步状态 ────────────────────────────────────────────

export async function get_sync_status(kv: KVNamespace, version_id: string): Promise<SyncStatus> {
  const raw = await kv.get(status_key(version_id));
  // KV returns null when key doesn't exist
  if (raw === null) return "not_started";
  if (is_sync_status(raw)) return raw;
  return "failed";
}

function is_sync_status(value: string): value is SyncStatus {
  return ["not_started", "in_progress", "complete", "partial", "failed"].includes(value);
}

export async function set_sync_status(
  kv: KVNamespace,
  version_id: string,
  status: SyncStatus,
): Promise<void> {
  await kv.put(status_key(version_id), status);
}

// ── 版本清单缓存 ────────────────────────────────────────

export async function get_cached_versions(kv: KVNamespace): Promise<string[]> {
  return (await kv.get(KNOWN_VERSIONS_KEY, "json")) ?? [];
}

export async function set_cached_versions(kv: KVNamespace, versions: string[]): Promise<void> {
  await kv.put(KNOWN_VERSIONS_KEY, JSON.stringify(versions));
}

export function get_manifest_etag(kv: KVNamespace): Promise<string | null> {
  return kv.get(VERSION_MANIFEST_ETAG_KEY);
}

export async function set_manifest_etag(kv: KVNamespace, etag: string): Promise<void> {
  await kv.put(VERSION_MANIFEST_ETAG_KEY, etag);
}

export function get_cached_manifest_body(kv: KVNamespace): Promise<string | null> {
  return kv.get(VERSION_MANIFEST_BODY_KEY);
}

export async function set_cached_manifest_body(kv: KVNamespace, body: string): Promise<void> {
  await kv.put(VERSION_MANIFEST_BODY_KEY, body);
}
