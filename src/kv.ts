import type { QueuePriority, SyncStatus } from "./types.ts";

/** KV 状态/队列管理 使用 FIFO 数组队列存储待同步的版本 ID，按优先级分三个队列；另有模组加载器产物队列（`sync:queue:modloader`）。 */

// ── 队列操作 ────────────────────────────────────────────

const QUEUE_PREFIX = "sync:queue:";
const KNOWN_VERSIONS_KEY = "known:versions";
const VERSION_MANIFEST_ETAG_KEY = "version_manifest:etag";
const VERSION_MANIFEST_BODY_KEY = "version_manifest:body";

function queue_key(priority: QueuePriority): string {
  return QUEUE_PREFIX + priority;
}

function modloader_queue_key(): string {
  return QUEUE_PREFIX + "modloader";
}

function status_key(version_id: string): string {
  return `sync:status:${version_id}`;
}

async function push_item(kv: KVNamespace, key: string, item: string): Promise<void> {
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  if (!queue.includes(item)) {
    queue.push(item);
    await kv.put(key, JSON.stringify(queue));
  }
}

async function pop_item(kv: KVNamespace, key: string): Promise<string | null> {
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  if (queue.length === 0) return null;
  const item = queue.shift()!;
  await kv.put(key, JSON.stringify(queue));
  return item;
}

async function count_items(kv: KVNamespace, key: string): Promise<number> {
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  return queue.length;
}

export function push_to_queue(
  kv: KVNamespace,
  priority: QueuePriority,
  version_id: string,
): Promise<void> {
  return push_item(kv, queue_key(priority), version_id);
}

export function pop_from_queue(kv: KVNamespace, priority: QueuePriority): Promise<string | null> {
  return pop_item(kv, queue_key(priority));
}

export function queue_length(kv: KVNamespace, priority: QueuePriority): Promise<number> {
  return count_items(kv, queue_key(priority));
}

/** 从队列中移除匹配某版本 ID 的条目（兼容 JSON 条目与旧版纯 ID 格式） */
export async function remove_version_from_queue(
  kv: KVNamespace,
  priority: QueuePriority,
  version_id: string,
): Promise<void> {
  const key = queue_key(priority);
  const queue: string[] = (await kv.get(key, "json")) ?? [];
  const next = queue.filter(entry => {
    if (entry === version_id) return false;
    try {
      const parsed = JSON.parse(entry);
      return !(typeof parsed === "object" && parsed !== null && parsed.id === version_id);
    } catch {
      return true;
    }
  });
  if (next.length !== queue.length) {
    await kv.put(key, JSON.stringify(next));
  }
}

// ── 模组加载器产物队列 ──────────────────────────────────

export function push_modloader_entry(kv: KVNamespace, entry: string): Promise<void> {
  return push_item(kv, modloader_queue_key(), entry);
}

export function pop_modloader_entry(kv: KVNamespace): Promise<string | null> {
  return pop_item(kv, modloader_queue_key());
}

export function modloader_queue_length(kv: KVNamespace): Promise<number> {
  return count_items(kv, modloader_queue_key());
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
