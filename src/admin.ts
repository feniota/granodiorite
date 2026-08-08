/** 管理后台 API */

import { get_timeline, get_type_breakdown, get_overview } from "./db.ts";
import * as kv from "./kv.ts";
import type { QueuePriority, SyncStatus } from "./types.ts";

// ── UUID 验证中间件 ────────────────────────────────────

/** 检查请求路径中的 uuid 是否匹配 ADMIN_UUID */
export function check_admin_uuid(pathname: string, admin_uuid: string): string | null {
  const m = pathname.match(/^\/([0-9a-f-]{36})\/api\/(.+)$/u);
  if (!m || m[1] !== admin_uuid) return null;
  return m[2]; // 返回 API 路径部分
}

// ── 版本管理 ───────────────────────────────────────────

interface VersionEntry {
  id: string;
  type: string;
  status: SyncStatus;
  time: string;
}

/** 获取已知版本列表（分页） */
export async function get_versions(
  env: Env,
  cursor?: string,
  limit = 50,
  type_filter?: string,
  status_filter?: SyncStatus,
): Promise<{ versions: VersionEntry[]; next_cursor: string | null; total: number }> {
  const known = await kv.get_cached_versions(env.GRANODIORITE_KV);
  const manifest_raw = await kv.get_cached_manifest_body(env.GRANODIORITE_KV);
  let manifest_versions: Array<{ id: string; type: string; time: string }> = [];
  if (manifest_raw) {
    try {
      manifest_versions = JSON.parse(manifest_raw).versions ?? [];
    } catch {
      /* ignore */
    }
  }
  const type_map = new Map(manifest_versions.map(v => [v.id, { type: v.type, time: v.time }]));

  // 筛选
  let filtered = known;
  if (type_filter) {
    filtered = filtered.filter(id => type_map.get(id)?.type === type_filter);
  }

  // 分页（cursor 是上一页最后一个版本 ID）
  const start_idx = cursor ? filtered.indexOf(cursor) + 1 : 0;
  if (start_idx < 0) {
    return { versions: [], next_cursor: null, total: filtered.length };
  }
  const page = filtered.slice(start_idx, start_idx + limit);

  // 并行批量读取同步状态（每页最多 100 个版本；串行 KV 读会造成 20s+ 延迟）
  const status_entries = await Promise.all(
    page.map(async id => [id, await kv.get_sync_status(env.GRANODIORITE_KV, id)] as const),
  );
  const status_map = new Map(status_entries);

  const versions: VersionEntry[] = [];
  for (const id of page) {
    const status = status_map.get(id);
    if (status_filter && status !== status_filter) continue;
    const meta = type_map.get(id);
    versions.push({
      id,
      type: meta?.type ?? "unknown",
      status: status ?? "not_started",
      time: meta?.time ?? "",
    });
  }

  const next_cursor = start_idx + limit < filtered.length ? (page.at(-1) ?? null) : null;

  return { versions, next_cursor, total: filtered.length };
}

// ── 同步队列 ───────────────────────────────────────────

interface QueueInfo {
  priority: string;
  length: number;
  items: string[];
}

/** 获取所有同步队列状态（含模组加载器产物队列） */
export async function get_queues(env: Env): Promise<QueueInfo[]> {
  const priorities: QueuePriority[] = ["high", "medium", "lazy"];
  const lengths = await Promise.all(
    priorities.map(async p => [p, await kv.queue_length(env.GRANODIORITE_KV, p)] as const),
  );
  const result: QueueInfo[] = lengths.map(([p, len]) => ({ priority: p, length: len, items: [] }));
  const mod_len = await kv.modloader_queue_length(env.GRANODIORITE_KV);
  result.push({ priority: "modloader", length: mod_len, items: [] });
  return result;
}

// ── 触发同步 ───────────────────────────────────────────

/** 触发指定版本同步：移出原队列并加入高优先级队列，由 cron 在后台执行 */
export async function trigger_sync(
  env: Env,
  version_id: string,
): Promise<{ success: boolean; message: string }> {
  // 先从 manifest 找版本 url
  const manifest_raw = await kv.get_cached_manifest_body(env.GRANODIORITE_KV);
  let version_url = "";
  if (manifest_raw) {
    try {
      const manifest = JSON.parse(manifest_raw);
      const v = manifest.versions?.find((x: { id: string }) => x.id === version_id);
      if (v?.url) version_url = v.url;
    } catch {
      /* ignore */
    }
  }

  if (!version_url) {
    return { success: false, message: `Version ${version_id} not found in manifest` };
  }

  // 从原优先级队列移除，避免 cron 重复同步（队列计数随之下降）
  const priorities = ["high", "medium", "lazy"] as const;
  for (const p of priorities) {
    await kv.remove_version_from_queue(env.GRANODIORITE_KV, p, version_id);
  }

  // 加入高优先级队列，由 15 分钟 cron 尽快处理；状态先标记为同步中
  await kv.push_to_queue(
    env.GRANODIORITE_KV,
    "high",
    JSON.stringify({ id: version_id, url: version_url }),
  );
  await kv.set_sync_status(env.GRANODIORITE_KV, version_id, "in_progress");

  return { success: true, message: `${version_id} 已加入高优先级同步队列` };
}

// ── 统计 ───────────────────────────────────────────────

export async function get_admin_stats(env: Env) {
  const [overview, timeline, breakdown] = await Promise.all([
    get_overview(env.ANALYTICS_DB),
    get_timeline(env.ANALYTICS_DB, 30),
    get_type_breakdown(env.ANALYTICS_DB),
  ]);
  return { overview, timeline, breakdown };
}
