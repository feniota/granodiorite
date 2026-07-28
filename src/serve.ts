import { fetch_file, fetch_version_json } from "./mojang.ts";
import * as r2 from "./r2.ts";
import { route } from "./routes.ts";
import type { Resource, VersionManifest } from "./types.ts";

/** 下载锁的 TTL（秒），防止并发拉取同一文件 */
const DOWNLOAD_LOCK_TTL = 120;

/** 小文件直接服务阈值（字节）。≤ 此大小的文件不 302 跳转，直接从 Worker 内存读取 R2 返回。
 * 1 MiB：覆盖绝大部分 asset 对象和库文件，避免小文件的 TLS 握手开销。 */
const SMALL_FILE_THRESHOLD = 1 * 1024 * 1024;

/** 尝试获取下载锁，防止并发拉取同一文件 */
async function try_acquire_lock(
  kv: KVNamespace,
  r2_key: string,
): Promise<boolean> {
  const lock_key = `dl:lock:${r2_key}`;
  const existing = await kv.get(lock_key);
  if (existing === "in_progress") return false;
  await kv.put(lock_key, "in_progress", { expirationTtl: DOWNLOAD_LOCK_TTL });
  return true;
}

/** 处理 HTTP 请求 */
export async function handle_request(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (pathname === "/health") {
    return new Response("OK", { status: 200 });
  }

  const resource = route(pathname);
  if (!resource) {
    return new Response("Not Found", { status: 404 });
  }

  // 检查 R2 缓存
  const cached = await r2.head(env.MIRROR_BUCKET, resource.r2_key);
  if (cached) {
    const if_none_match = request.headers.get("If-None-Match");
    if (if_none_match && cached.etag === if_none_match) {
      return new Response(null, { status: 304 });
    }

    // 小文件：直接从 Worker 内存返回（避免 302 重定向的 TLS 握手开销）
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

    // 大文件：302 重定向到 R2 公开桶，让客户端直接下载
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

  // client_jar 需要先从 version.json 获取真实的下载 URL
  if (resource.type === "client_jar") {
    return proxy_client_jar(resource, env, ctx);
  }

  // 版本 JSON：缓存到 R2 + 后台预缓存该版本的其他文件
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
    const [client_stream, r2_stream] = origin_res.body!.tee();
    ctx.waitUntil(
      env.MIRROR_BUCKET.put(resource.r2_key, r2_stream, {
        httpMetadata: {
          contentType: origin_res.headers.get("Content-Type") ??
            "application/octet-stream",
        },
      }),
    );
    return new Response(client_stream, {
      status: 200,
      headers: {
        "Content-Type": origin_res.headers.get("Content-Type") ??
          "application/octet-stream",
        "Cache-Control": "public, max-age=604800",
        "X-Cache": "MISS",
      },
    });
  }

  console.log({ event: "PROXY_PASSTHROUGH", key: resource.r2_key });
  // 已有其他请求在下载：直接透传，不写 R2
  return new Response(origin_res.body, {
    status: 200,
    headers: {
      "Content-Type": origin_res.headers.get("Content-Type") ??
        "application/octet-stream",
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
  const content_type = origin_res.headers.get("Content-Type") ??
    "application/json";

  // 缓存到 R2
  ctx.waitUntil(
    env.MIRROR_BUCKET.put(resource.r2_key, body, {
      httpMetadata: { contentType: content_type },
    }),
  );

  // 后台预缓存：解析 version JSON 后下载 client JAR + asset index
  try {
    const manifest: VersionManifest = JSON.parse(
      new TextDecoder().decode(body),
    );
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

/** 后台预缓存版本文件 */
async function precache_version(
  manifest: VersionManifest,
  env: Env,
): Promise<void> {
  const version_id = manifest.id;

  // 预缓存 client JAR
  const client = manifest.downloads?.client;
  if (
    client &&
    !(await r2.head(env.MIRROR_BUCKET, `minecraft/clients/${version_id}.jar`))
  ) {
    console.log({ event: "PRECACHE_CLIENT", version: version_id });
    try {
      const res = await fetch_file(client.url);
      if (!res.ok || !res.body) {
        console.log({
          event: "PRECACHE_CLIENT_FAIL",
          version: version_id,
          status: res.status,
        });
        return;
      }
      await env.MIRROR_BUCKET.put(
        `minecraft/clients/${version_id}.jar`,
        res.body,
        {
          httpMetadata: { contentType: "application/java-archive" },
        },
      );
      console.log({ event: "PRECACHE_CLIENT_DONE", version: version_id });
    } catch (e) {
      console.log({
        event: "PRECACHE_CLIENT_ERROR",
        version: version_id,
        error: String(e),
      });
    }
  }
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
