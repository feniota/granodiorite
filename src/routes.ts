import type { Resource } from "./types.ts";
import {
  asset_storage_key,
  version_json_key,
  client_jar_key,
  asset_index_key,
  library_key,
  version_manifest_key,
} from "./utils.ts";

/** Minecraft 版本清单 */
const VERSION_MANIFEST_ORIGIN = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

/** 版本 JSON 基础 URL */
const VERSION_JSON_ORIGIN = "https://piston-meta.mojang.com/v1/packages";

/** 资源对象基础 URL */
const ASSETS_ORIGIN = "https://resources.download.minecraft.net";

/** Maven 库基础 URL */
const LIBRARIES_ORIGIN = "https://libraries.minecraft.net";

/** 特殊端点：返回 null 表示此路径不由 route 处理 */
function match_special(pathname: string): Resource | null {
  if (pathname === "/health") return null;
  if (pathname === "/version_manifest" || pathname === "/mc/game/version_manifest_v2.json") {
    return {
      type: "version_manifest",
      r2_key: version_manifest_key(),
      origin_url: VERSION_MANIFEST_ORIGIN,
    };
  }
  return null;
}

/** Assets 对象: /assets/<pre2>/<hash> */
function match_asset(pathname: string): Resource | null {
  const m = pathname.match(/^\/assets\/([0-9a-f]{2})\/([0-9a-f]{40})$/u);
  if (!m) return null;
  const hash = m[2];
  return {
    type: "asset" as const,
    hash,
    r2_key: asset_storage_key(hash),
    origin_url: `${ASSETS_ORIGIN}/${m[1]}/${hash}`,
  };
}

/** Maven 库文件: /libraries/<path> */
function match_minecraft_library(pathname: string): Resource | null {
  const m = pathname.match(/^\/libraries\/(.+)$/u);
  if (!m) return null;
  return {
    type: "library" as const,
    r2_key: library_key(m[1]),
    origin_url: `${LIBRARIES_ORIGIN}/${m[1]}`,
  };
}

/** 模组加载器 Maven */
function match_maven_proxy(pathname: string): Resource | null {
  const patterns = [
    { prefix: "/maven/fabric/", host: "maven.fabricmc.net", type: "fabric_maven" as const },
    { prefix: "/maven/neoforge/", host: "maven.neoforged.net", type: "neoforge_maven" as const },
    // 必须先于 /maven/forge/ 匹配，否则 forge-legacy 路径会被 forge 路由吞掉
    {
      prefix: "/maven/forge-legacy/",
      host: "files.minecraftforge.net/maven",
      type: "forge_legacy_maven" as const,
    },
    { prefix: "/maven/forge/", host: "maven.minecraftforge.net", type: "forge_maven" as const },
    { prefix: "/fabric-meta/", host: "meta.fabricmc.net", type: "fabric_meta" as const },
  ];

  for (const { prefix, host, type } of patterns) {
    if (pathname.startsWith(prefix)) {
      const maven_path = pathname.slice(prefix.length);
      return {
        type,
        r2_key: `minecraft${pathname}`,
        origin_url: `https://${host}/${maven_path}`,
      };
    }
  }
  return null;
}

/** 版本 JSON: /v1/packages/<sha1>/<id>.json */
function match_version_json(pathname: string): Resource | null {
  const m = pathname.match(/^\/v1\/packages\/([0-9a-f]{40})\/(.+)\.json$/u);
  if (!m) return null;
  return {
    type: "version_json" as const,
    version_id: m[2],
    r2_key: version_json_key(m[2]),
    origin_url: `${VERSION_JSON_ORIGIN}/${m[1]}/${m[2]}.json`,
  };
}

/** 客户端/服务端 JAR: /versions/<id>/<id>.jar */
function match_jar(pathname: string): Resource | null {
  const m = pathname.match(/^\/versions\/([^/]+)\/([^/]+)\.jar$/u);
  if (!m) return null;
  const version_id = m[1];
  return {
    type: "client_jar" as const,
    version_id,
    r2_key: client_jar_key(version_id),
    origin_url: "",
  };
}

/** Assets 索引: /assets/indexes/<id>.json */
function match_asset_index(pathname: string): Resource | null {
  const m = pathname.match(/^\/assets\/indexes\/(.+)\.json$/u);
  if (!m) return null;
  const asset_id = m[1];
  return {
    type: "asset_index" as const,
    id: asset_id,
    r2_key: asset_index_key(asset_id),
    origin_url: `https://piston-meta.mojang.com/v1/packages/${asset_id}/${asset_id}.json`,
  };
}

/** Piston data 对象: /v1/objects/<sha1>/<file> (client JAR等) */
function match_piston_object(pathname: string): Resource | null {
  const m = pathname.match(/^\/v1\/objects\/([0-9a-f]{40})\/(.+)$/u);
  if (!m) return null;
  const sha1 = m[1];
  return {
    type: "asset" as const,
    hash: sha1,
    r2_key: `piston-objects/${sha1}/${m[2]}`,
    origin_url: `https://piston-data.mojang.com/v1/objects/${sha1}/${m[2]}`,
  };
}

/** 解析请求路径，返回资源描述或 null（无法识别的路径） */
export function route(pathname: string): Resource | null {
  return (
    match_special(pathname) ??
    match_asset(pathname) ??
    match_minecraft_library(pathname) ??
    match_maven_proxy(pathname) ??
    match_version_json(pathname) ??
    match_piston_object(pathname) ??
    match_jar(pathname) ??
    match_asset_index(pathname)
  );
}
