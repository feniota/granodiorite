import { push_to_queue } from "./kv.ts";
import { fetch_file, fetch_version_json } from "./mojang.ts";
import * as r2 from "./r2.ts";
import { route } from "./routes.ts";
import type { Resource } from "./types.ts";

// ── 重要版本列表（高优先级同步）─────────────────────────
export const HIGH_PRIORITY_VERSIONS = [
  "1.7.10",
  "1.8.9",
  "1.12.2",
  "1.16.5",
  "1.18.2",
  "1.20.1",
  "1.21.1",
  // 最新稳定版 26.2 在运行时动态添加
];

/** 处理 HTTP 请求 */
export async function handle_request(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // ── 健康检查 ──
  if (pathname === "/health") {
    return new Response("OK", { status: 200 });
  }

  // ── 路由解析 ──
  const resource = route(pathname);
  if (!resource) {
    return new Response("Not Found", { status: 404 });
  }

  // ── 检查 R2 缓存 ──
  const cached = await r2.head(env.MIRROR_BUCKET, resource.r2_key);
  if (cached) {
    // 支持条件请求
    const if_none_match = request.headers.get("If-None-Match");
    if (if_none_match && cached.etag === if_none_match) {
      return new Response(null, { status: 304 });
    }

    // 302 重定向到公开桶
    return new Response(null, {
      status: 302,
      headers: {
        Location: r2.public_url(env.PUBLIC_BUCKET_DOMAIN, resource.r2_key),
        ETag: cached.etag,
        "Cache-Control": "public, max-age=604800",
      },
    });
  }

  // ── R2 未命中：从源站拉取 ──
  // client_jar 需要先从 version.json 获取真实的下载 URL
  if (resource.type === "client_jar") {
    return proxy_client_jar(resource, env, ctx);
  }

  return proxy_from_origin(resource, env, ctx);
}

/** 透明代理：从源站拉取 → 写入 R2 → 返回给客户端 */
async function proxy_from_origin(
  resource: Resource,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // 从源站拉取
  const origin_res = await fetch_file(resource.origin_url);
  if (!origin_res.ok) {
    return origin_res;
  }

  // 注册懒同步（如果是版本 JSON）
  if (resource.type === "version_json") {
    ctx.waitUntil(push_to_queue(env.GRANODIORITE_KV, "lazy", resource.version_id));
  }

  // Tee：同时写入 R2 和返回客户端
  const [client_stream, r2_stream] = origin_res.body!.tee();
  ctx.waitUntil(
    r2.put_stream(
      env.MIRROR_BUCKET,
      resource.r2_key,
      r2_stream,
      origin_res.headers.get("Content-Type") ?? undefined,
    ),
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

/** 代理客户端 JAR：需要先从 version.json 获取下载 URL */
async function proxy_client_jar(
  resource: Extract<Resource, { type: "client_jar" }>,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { version_id } = resource;

  try {
    // 先获取 version.json 来解析客户端 JAR 的下载地址
    const version_json = await fetch_version_json(
      `https://launchermeta.mojang.com/v1/packages/${version_id}/${version_id}.json`,
    );

    const client_url = version_json.downloads?.client?.url;
    if (!client_url) {
      return new Response("Client JAR not available for this version", {
        status: 404,
      });
    }

    // 从正确 URL 拉取
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
