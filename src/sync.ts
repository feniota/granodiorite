import * as kv from "./kv.ts";
import {
  fetch_version_manifest,
  fetch_version_json,
  fetch_file,
  fetch_asset_index,
} from "./mojang.ts";
import * as r2 from "./r2.ts";

// ── 重要版本列表 ─────────────────────────────────────────
export const HIGH_PRIORITY_VERSIONS = [
  "1.7.10",
  "1.8.9",
  "1.12.2",
  "1.16.5",
  "1.18.2",
  "1.20.1",
  "1.21.1",
  // 26.2 在运行时加入
];

// ── 版本清单同步 (cron: */30 * * * *) ─────────────────────

export async function sync_version_manifest(env: Env): Promise<void> {
  const etag = await kv.get_manifest_etag(env.GRANODIORITE_KV);
  const [manifest, new_etag] = await fetch_version_manifest(etag);

  if (!manifest) {
    // 304 — 未变更
    return;
  }

  // 获取已知版本列表
  const known = await kv.get_cached_versions(env.GRANODIORITE_KV);
  const known_set = new Set(known);

  // 找出新版本
  const new_versions = manifest.versions.filter(v => !known_set.has(v.id));

  if (new_versions.length === 0) return;

  // 按类型入队
  for (const v of new_versions) {
    const entry = JSON.stringify({ id: v.id, url: v.url });
    if (HIGH_PRIORITY_VERSIONS.includes(v.id) || v.id === manifest.latest.release) {
      await kv.push_to_queue(env.GRANODIORITE_KV, "high", entry);
    } else if (v.type === "release") {
      await kv.push_to_queue(env.GRANODIORITE_KV, "medium", entry);
    } else {
      await kv.push_to_queue(env.GRANODIORITE_KV, "lazy", entry);
    }
  }

  // 更新 known 列表
  const all_ids = manifest.versions.map(v => v.id);
  await kv.set_cached_versions(env.GRANODIORITE_KV, all_ids);

  // 缓存清单 body 和 etag（供其他功能使用，如 resolve_version_sha1）
  await kv.set_cached_manifest_body(env.GRANODIORITE_KV, JSON.stringify(manifest));
  await kv.set_manifest_etag(env.GRANODIORITE_KV, new_etag!);
}

// ── 版本文件同步 (cron: */15 * * * *) ─────────────────────

export async function process_sync_queue(env: Env): Promise<void> {
  // 高优先级每轮 3 个，中/低优先级每轮各 1 个（低优先级由 cron 缓慢消化，逐步实现全量缓存）
  const priorities = ["high", "medium", "lazy"] as const;

  for (const priority of priorities) {
    const length = await kv.queue_length(env.GRANODIORITE_KV, priority);
    const batch_size = priority === "high" ? 3 : 1;

    for (let i = 0; i < Math.min(length, batch_size); i++) {
      const entry = await kv.pop_from_queue(env.GRANODIORITE_KV, priority);
      if (!entry) break;

      let version_id: string;
      let version_url: string;
      try {
        const parsed = JSON.parse(entry);
        // JSON.parse("1.20.3") 返回字符串，不抛异常。需要显式判断是否真的是对象
        if (typeof parsed !== "object" || typeof parsed.id !== "string") {
          throw new TypeError("Not a valid queue entry");
        }
        version_id = parsed.id;
        version_url = parsed.url;
      } catch {
        // 旧格式：队列里是纯 version_id
        version_id = entry;
        const sha1 = await resolve_version_sha1(version_id, env);
        version_url = `https://piston-meta.mojang.com/v1/packages/${sha1}/${version_id}.json`;
      }

      try {
        await sync_single_version(version_id, version_url, env);
        await kv.set_sync_status(env.GRANODIORITE_KV, version_id, "complete");
      } catch (e) {
        console.error({
          event: "SYNC_FAILED",
          version_id,
          error: String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        await kv.set_sync_status(env.GRANODIORITE_KV, version_id, "failed");
        await kv.push_to_queue(env.GRANODIORITE_KV, priority, entry);
      }
    }
  }
}

async function resolve_version_sha1(version_id: string, env: Env): Promise<string> {
  // 从 KV 缓存的已知版本清单中查找版本 URL（manifest 的版本条目里没有 sha1 字段，sha1 在 url 路径中）
  const cached = await kv.get_cached_manifest_body(env.GRANODIORITE_KV);
  if (cached) {
    const manifest = JSON.parse(cached);
    const v = manifest.versions?.find((x: { id: string }) => x.id === version_id);
    if (typeof v?.url === "string") {
      return extract_sha1_from_url(v.url as string);
    }
  }
  // 兜底：从 manifest API 最新数据获取
  const [fresh] = await fetch_version_manifest();
  if (fresh) {
    const v = fresh.versions.find(x => x.id === version_id);
    if (v?.url) return extract_sha1_from_url(v.url);
  }
  throw new Error(`Cannot resolve SHA1 for ${version_id}`);
}

/** 从 piston-meta URL 中提取 SHA1（URL 格式：.../packages/{sha1}/{version_id}.json） */
function extract_sha1_from_url(url: string): string {
  const parts = url.split("/");
  return parts.at(parts.length - 2)!;
}

// ── 单版本同步 ───────────────────────────────────────────

export async function sync_single_version(
  version_id: string,
  version_url: string,
  env: Env,
): Promise<void> {
  await kv.set_sync_status(env.GRANODIORITE_KV, version_id, "in_progress");

  // 1. 获取版本 JSON
  const version_json = await fetch_version_json(version_url);

  // 2. 缓存版本 JSON 到 R2
  const v_key = `minecraft/versions/${version_id}.json`;
  await r2.put(env.MIRROR_BUCKET, v_key, JSON.stringify(version_json), {
    httpMetadata: { contentType: "application/json" },
  });

  // 3. 下载并缓存 client JAR
  const client = version_json.downloads?.client;
  if (client) {
    const client_key = `minecraft/clients/${version_id}.jar`;
    await proxy_and_cache(env, client_key, client.url);
  }

  // 4. 下载并缓存 asset index
  const asset_index = version_json.asset_index;
  if (asset_index) {
    const ai_key = `minecraft/assets/indexes/${asset_index.id}.json`;
    await proxy_and_cache(env, ai_key, asset_index.url);

    // 5. 下载 asset 对象
    const asset_list = await fetch_asset_index(asset_index.url, asset_index.sha1);
    let asset_count = 0;
    for (const [_name, obj] of Object.entries(asset_list.objects)) {
      const hash = obj.hash;
      const asset_key = `minecraft/assets/${hash.slice(0, 2)}/${hash}`;

      // 跳过已缓存的
      const existing = await r2.head(env.MIRROR_BUCKET, asset_key);
      if (existing) continue;

      const asset_url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
      await proxy_and_cache(env, asset_key, asset_url);
      asset_count++;

      // 防止单次 cron 同步超时，限制每次最多下载 500 个资源
      if (asset_count >= 500) break;
    }
  }

  await kv.set_sync_status(env.GRANODIORITE_KV, version_id, "complete");
}

/** 下载文件并缓存到 R2 */
async function proxy_and_cache(env: Env, key: string, url: string): Promise<void> {
  const res = await fetch_file(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  await env.MIRROR_BUCKET.put(key, res.body, {
    httpMetadata: {
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
    },
  });
}
