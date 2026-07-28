import type { VersionIndex, VersionManifest } from "./types.ts";

/** 源站 HTTP 客户端 负责从 Mojang 和模组加载器源站拉取资源，支持 ETag 增量更新。 */

const USER_AGENT = "Granodiorite/0.1.0 (Phenocryst; like BMCLAPI)";

interface FetchOptions {
  headers?: Record<string, string>;
}

/** 通用 HTTP GET 请求 */
function fetch_origin(url: string, options?: FetchOptions): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      ...options?.headers,
    },
  });
}

// ── 版本清单 ────────────────────────────────────────────

/** 拉取版本清单，支持 ETag 增量更新。 返回 [data, etag]；若服务器返回 304，则 data 为 null。 */
export async function fetch_version_manifest(
  etag?: string | null,
): Promise<[VersionIndex | null, string | null]> {
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;

  const res = await fetch_origin(
    "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    { headers },
  );

  // 304 = 未变更
  if (res.status === 304) return [null, null];

  if (!res.ok) {
    throw new Error(`Failed to fetch version manifest: ${res.status} ${res.statusText}`);
  }

  const new_etag = res.headers.get("ETag");
  const data: VersionIndex = await res.json();
  return [data, new_etag];
}

// ── 版本 JSON ────────────────────────────────────────────

/** 拉取版本 JSON（version.json），验证 SHA1 */
export async function fetch_version_json(url: string, sha1?: string): Promise<VersionManifest> {
  const res = await fetch_origin(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch version json: ${res.status}`);
  }

  if (sha1) {
    // 验证 SHA1
    const body = await res.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-1", body);
    const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha1) {
      throw new Error(`SHA1 mismatch for version json: expected ${sha1}, got ${hex}`);
    }
    return JSON.parse(new TextDecoder().decode(body)) as VersionManifest;
  }

  return res.json();
}

// ── 通用二进制文件 ──────────────────────────────────────

/** 从源站拉取文件并返回 Response（流式，不缓冲到内存） */
export function fetch_file(url: string): Promise<Response> {
  return fetch_origin(url);
}

/** 验证下载文件的 SHA1（需先缓冲 body 到内存） */
export async function verify_sha1(body: ArrayBuffer, expected: string): Promise<boolean> {
  const hash = await crypto.subtle.digest("SHA-1", body);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === expected;
}
