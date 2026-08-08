import * as admin from "./admin.ts";
import {
  track_hourly,
  maybe_rollup,
  get_timeline,
  get_type_breakdown,
  get_overview,
} from "./db.ts";
import { fetch_file, fetch_version_json, fetch_asset_index } from "./mojang.ts";
import * as r2 from "./r2.ts";
import { route } from "./routes.ts";
import type { Resource, VersionManifest } from "./types.ts";
import { asset_storage_key } from "./utils.ts";

/** 下载锁的 TTL（秒），防止并发拉取同一文件 */
const DOWNLOAD_LOCK_TTL = 120;

/** 小文件直接服务阈值（字节）。≤ 此大小的文件不 302 跳转，直接从 Worker 内存读取 R2 返回。 1 MiB：覆盖绝大部分 asset 对象和库文件，避免小文件的 TLS 握手开销。 */
const SMALL_FILE_THRESHOLD = 1 * 1024 * 1024;

/** 尝试获取下载锁，防止并发拉取同一文件 */
async function try_acquire_lock(kv: KVNamespace, r2_key: string): Promise<boolean> {
  const lock_key = `dl:lock:${r2_key}`;
  const existing = await kv.get(lock_key);
  if (existing === "in_progress") return false;
  await kv.put(lock_key, "in_progress", { expirationTtl: DOWNLOAD_LOCK_TTL });
  return true;
}

// ── 帮助函数：追踪并写入 D1 ───────────────────────────

function get_hour(): string {
  return new Date().toISOString().slice(0, 13) + ":00:00Z";
}

function track_in_background(
  env: Env,
  route_type: string,
  action: string,
  bytes: number,
): Promise<void> {
  const stmt = track_hourly(env.ANALYTICS_DB, get_hour(), route_type, action, bytes);
  return Promise.all([
    stmt.run().catch(() => {}),
    maybe_rollup(env.ANALYTICS_DB).catch(() => {}),
  ]).then(() => {});
}

// ── 处理 API 请求 ──────────────────────────────────────

/** /api/v2/stats/* — 公开统计 API */
async function handle_stats_api(pathname: string, env: Env): Promise<Response | null> {
  const cors_headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (pathname === "/api/v2/stats/overview") {
    const data = await get_overview(env.ANALYTICS_DB);
    return Response.json(data, { headers: cors_headers });
  }
  if (pathname === "/api/v2/stats/timeline") {
    const data = await get_timeline(env.ANALYTICS_DB, 30);
    return Response.json(data, { headers: cors_headers });
  }
  if (pathname === "/api/v2/stats/by-type") {
    const data = await get_type_breakdown(env.ANALYTICS_DB);
    return Response.json(data, { headers: cors_headers });
  }
  return null;
}

/** 管理后台 API 路由 */
async function handle_admin_api(url: URL, env: Env): Promise<Response | null> {
  const api_path = admin.check_admin_uuid(url.pathname, env.ADMIN_UUID);
  if (!api_path) return null;

  const cors_headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // GET /<uuid>/api/versions — 版本列表（分页）
  if (api_path === "versions") {
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const type_filter = url.searchParams.get("type") ?? undefined;
    const status_filter = url.searchParams.get("status") ?? undefined;
    const data = await admin.get_versions(
      env,
      cursor,
      limit,
      type_filter,
      status_filter as import("./types.ts").SyncStatus | undefined,
    );
    return Response.json(data, { headers: cors_headers });
  }

  // GET /<uuid>/api/versions/queue — 同步队列
  if (api_path === "versions/queue") {
    const data = await admin.get_queues(env);
    return Response.json(data, { headers: cors_headers });
  }

  // POST /<uuid>/api/versions/sync — 触发同步
  if (api_path === "versions/sync") {
    // 不支持直接从请求读 body — 从 URL 参数获取版本 ID
    const version_id = url.searchParams.get("id");
    if (!version_id) {
      return Response.json(
        { success: false, message: "Missing 'id' parameter" },
        { status: 400, headers: cors_headers },
      );
    }
    const result = await admin.trigger_sync(env, version_id);
    return Response.json(result, { headers: cors_headers });
  }

  // GET /<uuid>/api/stats — 管理用详细统计
  if (api_path === "stats") {
    const data = await admin.get_admin_stats(env);
    return Response.json(data, { headers: cors_headers });
  }

  return null;
}

/** 处理 HTTP 请求 */
export async function handle_request(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // OPTIONS 预检
  if (request.method === "OPTIONS") {
    const cors_headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    return new Response(null, { status: 204, headers: cors_headers });
  }

  // 健康检查
  if (pathname === "/health") {
    return new Response("OK", { status: 200 });
  }

  // ── 公开统计 API ──
  if (pathname.startsWith("/api/v2/stats/")) {
    const res = await handle_stats_api(pathname, env);
    if (res) return res;
  }

  // ── 管理后台 API ──
  if (pathname.includes("/api/")) {
    const res = await handle_admin_api(url, env);
    if (res) return res;
  }

  // ── Minecraft 资源路由 ──
  const resource = route(pathname);
  if (resource) {
    return serve_resource(request, resource, env, ctx);
  }

  // ── 前端页面（MPA） ──
  // /            → 统计面板 index.html
  // /<uuid>      → 管理面板 admin.html（uuid 格式服务端校验，页面本身无鉴权）
  // 静态资源     → 从 Assets 直接返回
  // 其余未匹配   → 极简 JSON 404
  if (env.ASSETS) {
    // 管理面板入口
    const is_admin_page = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      pathname,
    );

    // 页面入口：返回对应 HTML（Assets 自动映射 index.html）
    if (pathname === "/" || pathname === "/index.html") {
      const index = await env.ASSETS.fetch(new Request("http://placeholder/", request));
      const body = await index.text();
      return new Response(body, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=0, must-revalidate",
        },
      });
    }

    // 管理面板独立 HTML 入口
    if (is_admin_page || pathname === "/admin.html") {
      const admin_html = await fetch_admin_html(env, request);
      if (admin_html) return admin_html;
    }

    // 已知文件扩展名的静态资源，直接从 Assets 获取
    if (/\.(?:js|css|png|jpg|gif|svg|ico|woff2?|ttf|eot|json|webp|avif)$/iu.test(pathname)) {
      const asset_res = await env.ASSETS.fetch(request);
      if (asset_res.status === 404) {
        return not_found_json(pathname);
      }
      return asset_res;
    }
  }

  return not_found_json(pathname);
}

/** 从 Assets 读取管理面板 admin.html（跟随可能的 307 去扩展名重定向） */
async function fetch_admin_html(env: Env, request: Request): Promise<Response | null> {
  const admin_res = await env.ASSETS.fetch(new Request("http://placeholder/admin.html", request));

  // Assets 会把 /admin.html 307 重定向到 /admin，跟随到最终内容
  let target = admin_res;
  if (!admin_res.ok && [301, 302, 307].includes(admin_res.status)) {
    const location = admin_res.headers.get("Location");
    if (!location) return null;
    target = await env.ASSETS.fetch(new Request(`http://placeholder${location}`, request));
  }

  if (!target.ok) return null;

  const body = await target.text();
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

/** 未匹配路径的统一 JSON 404 响应（程序可读，无 HTML） */
function not_found_json(pathname: string): Response {
  return Response.json({ error: "Not Found", path: pathname }, { status: 404 });
}

/** 处理资源请求（R2 缓存检查 + 透传代理 + 统计追踪） */
async function serve_resource(
  request: Request,
  resource: Resource,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 检查 R2 缓存
  const cached = await r2.head(env.MIRROR_BUCKET, resource.r2_key);
  if (cached) {
    const if_none_match = request.headers.get("If-None-Match");
    if (if_none_match && cached.etag === if_none_match) {
      return new Response(null, { status: 304 });
    }

    // 统计追踪：缓存命中
    ctx.waitUntil(track_in_background(env, resource.type, "hit", cached.size ?? 0));

    // 小文件：直接从 Worker 内存返回
    if (cached.size !== undefined && cached.size <= SMALL_FILE_THRESHOLD) {
      const obj = await env.MIRROR_BUCKET.get(resource.r2_key);
      if (!obj) {
        return new Response("Not Found", { status: 404 });
      }
      const headers: Record<string, string> = {
        ETag: cached.etag,
        "Cache-Control": "public, max-age=604800",
      };
      const ct = obj.httpMetadata?.contentType;
      if (ct) headers["Content-Type"] = ct;
      return new Response(obj.body, { headers });
    }

    // 大文件：302 重定向
    return new Response(null, {
      status: 302,
      headers: {
        Location: r2.public_url(env.PUBLIC_BUCKET_DOMAIN, resource.r2_key),
        ETag: cached.etag,
        "Cache-Control": "public, max-age=604800",
      },
    });
  }

  console.log({
    event: "CACHE_MISS",
    type: resource.type,
    key: resource.r2_key,
  });

  // client_jar 需要先从 version.json 获取真实下载 URL
  if (resource.type === "client_jar") {
    return proxy_client_jar(resource, env, ctx);
  }

  // 版本 JSON：缓存到 R2 + 后台预缓存
  if (resource.type === "version_json") {
    return proxy_version_json(resource, env, ctx);
  }

  return proxy_from_origin(resource, env, ctx);
}

/** 透明代理：从源站拉取 → 流式写入 R2 + 返回客户端 */
async function proxy_from_origin(
  resource: Resource,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 并发去重：同一文件正在下载中则跳过 R2 写入
  const locked = await try_acquire_lock(env.GRANODIORITE_KV, resource.r2_key);

  const origin_res = await fetch_file(resource.origin_url);
  if (!origin_res.ok) return origin_res;

  if (locked) {
    console.log({ event: "PROXY_LOCKED", key: resource.r2_key });
    const content_length = Number(origin_res.headers.get("Content-Length") ?? 0);
    ctx.waitUntil(track_in_background(env, resource.type, "miss_proxy", content_length));
    const [client_stream, r2_stream] = origin_res.body!.tee();
    ctx.waitUntil(
      env.MIRROR_BUCKET.put(resource.r2_key, r2_stream, {
        httpMetadata: {
          contentType: origin_res.headers.get("Content-Type") ?? "application/octet-stream",
        },
      }),
    );
    return new Response(client_stream, {
      status: 200,
      headers: {
        "Content-Type": origin_res.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "public, max-age=604800",
        "X-Cache": "MISS",
      },
    });
  }

  console.log({ event: "PROXY_PASSTHROUGH", key: resource.r2_key });
  const content_length = Number(origin_res.headers.get("Content-Length") ?? 0);
  ctx.waitUntil(track_in_background(env, resource.type, "miss_passthrough", content_length));
  // 已有其他请求在下载：直接透传，不写 R2
  return new Response(origin_res.body, {
    status: 200,
    headers: {
      "Content-Type": origin_res.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=604800",
    },
  });
}

/** 版本 JSON 代理 + 后台预缓存整个版本 */
async function proxy_version_json(
  resource: Resource,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  console.log({ event: "VERSION_JSON_MISS", key: resource.r2_key });
  const origin_res = await fetch_file(resource.origin_url);
  if (!origin_res.ok) return origin_res;

  // 完整读取 JSON 以便解析
  const body = await origin_res.arrayBuffer();
  const content_type = origin_res.headers.get("Content-Type") ?? "application/json";

  // 统计追踪
  ctx.waitUntil(track_in_background(env, resource.type, "miss_proxy", body.byteLength));

  // 缓存到 R2
  ctx.waitUntil(
    env.MIRROR_BUCKET.put(resource.r2_key, body, {
      httpMetadata: { contentType: content_type },
    }),
  );

  // 后台预缓存：解析 version JSON 后下载 client JAR + asset index
  try {
    const manifest: VersionManifest = JSON.parse(new TextDecoder().decode(body));
    console.log({ event: "PRECACHE_START", version: manifest.id });
    ctx.waitUntil(precache_version(manifest, env));
  } catch {
    // 解析失败不影响主流程
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": content_type,
      "Cache-Control": "public, max-age=604800",
      "X-Cache": "MISS",
    },
  });
}

/** 每轮按需预缓存的 asset 对象数量上限，防止单次请求超时 */
const PRECACHE_ASSET_LIMIT = 500;

/** 后台预缓存安装该版本所需的全部资源 */
async function precache_version(manifest: VersionManifest, env: Env): Promise<void> {
  const version_id = manifest.id;

  // ── client JAR ──
  const client = manifest.downloads?.client;
  if (client && !(await r2.head(env.MIRROR_BUCKET, `minecraft/clients/${version_id}.jar`))) {
    console.log({ event: "PRECACHE_CLIENT", version: version_id });
    try {
      const res = await fetch_file(client.url);
      if (!res.ok || !res.body) {
        console.log({ event: "PRECACHE_CLIENT_FAIL", version: version_id, status: res.status });
      } else {
        await env.MIRROR_BUCKET.put(`minecraft/clients/${version_id}.jar`, res.body, {
          httpMetadata: { contentType: "application/java-archive" },
        });
        console.log({ event: "PRECACHE_CLIENT_DONE", version: version_id });
      }
    } catch (e) {
      console.log({ event: "PRECACHE_CLIENT_ERROR", version: version_id, error: String(e) });
    }
  }

  // ── server JAR ──
  const server = manifest.downloads?.server;
  if (server && !(await r2.head(env.MIRROR_BUCKET, `minecraft/servers/${version_id}.jar`))) {
    console.log({ event: "PRECACHE_SERVER", version: version_id });
    try {
      const res = await fetch_file(server.url);
      if (!res.ok || !res.body) {
        console.log({ event: "PRECACHE_SERVER_FAIL", version: version_id, status: res.status });
      } else {
        await env.MIRROR_BUCKET.put(`minecraft/servers/${version_id}.jar`, res.body, {
          httpMetadata: { contentType: "application/java-archive" },
        });
        console.log({ event: "PRECACHE_SERVER_DONE", version: version_id });
      }
    } catch (e) {
      console.log({ event: "PRECACHE_SERVER_ERROR", version: version_id, error: String(e) });
    }
  }

  // ── asset index + asset 对象 ──
  const asset_index = manifest.asset_index;
  if (!asset_index) {
    console.log({ event: "PRECACHE_NO_ASSET_INDEX", version: version_id });
    return;
  }

  // 缓存 asset index 本身
  const ai_key = `minecraft/assets/indexes/${asset_index.id}.json`;
  if (!(await r2.head(env.MIRROR_BUCKET, ai_key))) {
    console.log({ event: "PRECACHE_ASSET_INDEX", version: version_id, index: asset_index.id });
    try {
      await proxy_and_cache(env, ai_key, asset_index.url);
      console.log({
        event: "PRECACHE_ASSET_INDEX_DONE",
        version: version_id,
        index: asset_index.id,
      });
    } catch (e) {
      console.log({
        event: "PRECACHE_ASSET_INDEX_ERROR",
        version: version_id,
        error: String(e),
      });
      return; // asset index 是后续资产的前置依赖，失败则跳过
    }
  }

  // 遍历 asset 对象，逐个缓存
  try {
    const asset_list = await fetch_asset_index(asset_index.url, asset_index.sha1);
    let asset_count = 0;
    for (const [_name, obj] of Object.entries(asset_list.objects)) {
      const asset_key = asset_storage_key(obj.hash);

      // 跳过已缓存的
      const existing = await r2.head(env.MIRROR_BUCKET, asset_key);
      if (existing) continue;

      const asset_url = `https://resources.download.minecraft.net/${obj.hash.slice(0, 2)}/${obj.hash}`;
      try {
        await proxy_and_cache(env, asset_key, asset_url);
        asset_count++;
      } catch (e) {
        console.log({
          event: "PRECACHE_ASSET_ERROR",
          version: version_id,
          hash: obj.hash,
          error: String(e),
        });
      }

      if (asset_count >= PRECACHE_ASSET_LIMIT) break;
    }
    console.log({
      event: "PRECACHE_ASSETS_DONE",
      version: version_id,
      count: asset_count,
    });
  } catch (e) {
    console.log({
      event: "PRECACHE_ASSET_LIST_ERROR",
      version: version_id,
      error: String(e),
    });
  }
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

/** 代理客户端 JAR：从 version.json 获取下载 URL */
async function proxy_client_jar(
  resource: Extract<Resource, { type: "client_jar" }>,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { version_id } = resource;

  try {
    const version_json = await fetch_version_json(
      `https://piston-meta.mojang.com/v1/packages/${version_id}/${version_id}.json`,
    );

    const client_url = version_json.downloads?.client?.url;
    if (!client_url) {
      return new Response("Client JAR not available for this version", {
        status: 404,
      });
    }

    const origin_res = await fetch_file(client_url);
    if (!origin_res.ok) return origin_res;

    const content_length = Number(origin_res.headers.get("Content-Length") ?? 0);
    ctx.waitUntil(track_in_background(env, resource.type, "miss_proxy", content_length));

    const [client_stream, r2_stream] = origin_res.body!.tee();
    ctx.waitUntil(r2.put_stream(env.MIRROR_BUCKET, resource.r2_key, r2_stream));

    return new Response(client_stream, {
      status: 200,
      headers: {
        "Content-Type": "application/java-archive",
        "Cache-Control": "public, max-age=604800",
        "X-Cache": "MISS",
      },
    });
  } catch {
    return new Response("Failed to resolve client JAR URL", { status: 502 });
  }
}
