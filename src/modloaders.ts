import * as kv from "./kv.ts";
import { fetch_file, fetch_version_manifest } from "./mojang.ts";
import * as r2 from "./r2.ts";
import { HIGH_PRIORITY_VERSIONS } from "./sync.ts";
import type { ModloaderArtifact } from "./types.ts";

/**
 * 模组加载器自动预缓存
 *
 * 覆盖 Fabric / NeoForge / Forge（含 legacy）： - 元数据（fabric-meta JSON、maven-metadata.xml）由 30 分钟 cron
 * 直接写入 R2； - 最新加载器/安装器 JAR 进入 `sync:queue:modloader`，由 15 分钟 cron 缓慢消化。
 */

const FABRIC_META_ORIGIN = "https://meta.fabricmc.net";
const FABRIC_MAVEN_ORIGIN = "https://maven.fabricmc.net";
const NEOFORGE_MAVEN_ORIGIN = "https://maven.neoforged.net";
const FORGE_MAVEN_ORIGIN = "https://maven.minecraftforge.net";
const FORGE_LEGACY_MAVEN_ORIGIN = "https://files.minecraftforge.net/maven";

/** 每次 cron 从 modloader 队列拉取的最大产物数（安装器 JAR 较大，每轮 2 个即可） */
const MODLOADER_BATCH_SIZE = 2;

// ── 目标版本 ────────────────────────────────────────────

/** 预缓存加载器的目标 MC 版本：高优先级列表 + 最新正式版 */
async function loader_target_versions(env: Env): Promise<Set<string>> {
  const targets = new Set<string>(HIGH_PRIORITY_VERSIONS);

  const manifest_raw = await kv.get_cached_manifest_body(env.GRANODIORITE_KV);
  if (manifest_raw) {
    try {
      const latest = (JSON.parse(manifest_raw) as { latest?: { release?: string } }).latest
        ?.release;
      if (latest) targets.add(latest);
      return targets;
    } catch {
      // 缓存损坏时回退到在线拉取
    }
  }

  const [fresh] = await fetch_version_manifest();
  if (fresh?.latest?.release) targets.add(fresh.latest.release);
  return targets;
}

// ── 元数据读写 ──────────────────────────────────────────

/** 读取元数据：已缓存则读 R2，否则拉取源站并写入 R2。返回文本或 null。 */
async function get_or_fetch_metadata(env: Env, key: string, url: string): Promise<string | null> {
  const existing = await r2.head(env.MIRROR_BUCKET, key);
  if (existing) {
    const obj = await r2.get(env.MIRROR_BUCKET, key);
    return obj ? obj.text() : null;
  }

  const res = await fetch_file(url);
  if (!res.ok) {
    console.error({ event: "MODLOADER_METADATA_FAIL", url, status: res.status });
    return null;
  }
  const body = await res.text();
  await r2.put(env.MIRROR_BUCKET, key, body, {
    httpMetadata: { contentType: res.headers.get("Content-Type") ?? "application/octet-stream" },
  });
  console.log({ event: "MODLOADER_METADATA_CACHED", key });
  return body;
}

// ── maven-metadata.xml 解析 ─────────────────────────────

/** 从 maven-metadata.xml 提取全部 <version> 条目 */
function extract_maven_versions(xml: string): string[] {
  const versions: string[] = [];
  const re = /<version>([^<]+)<\/version>/gu;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    versions.push(m[1]);
  }
  return versions;
}

/** 取某个 MC 版本对应的最新加载器版本（maven 版本形如 `<mc>-<loader>`，XML 内按升序排列） */
function latest_for_game(versions: string[], game: string): string | null {
  const prefix = `${game}-`;
  const matched = versions.filter(v => v.startsWith(prefix));
  return matched.at(-1) ?? null;
}

// ── 产物入队 ────────────────────────────────────────────

/** 产物未缓存时写入 modloader 队列（push 内部按字符串去重） */
async function enqueue_artifact(env: Env, key: string, url: string): Promise<void> {
  const existing = await r2.head(env.MIRROR_BUCKET, key);
  if (existing) return;

  const entry: ModloaderArtifact = { key, url };
  await kv.push_modloader_entry(env.GRANODIORITE_KV, JSON.stringify(entry));
  console.log({ event: "MODLOADER_ENQUEUED", key });
}

// ── Fabric ──────────────────────────────────────────────

/** 缓存 Fabric 全局/按版本元数据，并把最新 loader JAR 入队 */
async function sync_fabric(env: Env, targets: Set<string>): Promise<void> {
  await Promise.allSettled([
    get_or_fetch_metadata(
      env,
      "minecraft/fabric-meta/v2/versions/loader",
      `${FABRIC_META_ORIGIN}/v2/versions/loader`,
    ),
    get_or_fetch_metadata(
      env,
      "minecraft/fabric-meta/v2/versions/game",
      `${FABRIC_META_ORIGIN}/v2/versions/game`,
    ),
  ]);

  for (const game of targets) {
    const meta = await get_or_fetch_metadata(
      env,
      `minecraft/fabric-meta/v2/versions/loader/${game}`,
      `${FABRIC_META_ORIGIN}/v2/versions/loader/${game}`,
    );
    if (!meta) continue;

    let loader_version: string | null = null;
    try {
      const list = JSON.parse(meta) as Array<{ loader?: { version?: string; stable?: boolean } }>;
      loader_version =
        list.find(x => x.loader?.stable)?.loader?.version ?? list[0]?.loader?.version ?? null;
    } catch (e) {
      console.error({ event: "MODLOADER_FABRIC_PARSE_FAIL", game, error: String(e) });
      continue;
    }
    if (!loader_version) continue;

    const path = `net/fabricmc/fabric-loader/${loader_version}/fabric-loader-${loader_version}.jar`;
    await enqueue_artifact(env, `minecraft/maven/fabric/${path}`, `${FABRIC_MAVEN_ORIGIN}/${path}`);
  }
}

// ── NeoForge / Forge ────────────────────────────────────

/** 缓存 NeoForge/Forge maven-metadata.xml，并把各目标版本最新安装器入队 */
async function sync_forge_family(env: Env, targets: Set<string>): Promise<void> {
  const [neo_xml, forge_xml, legacy_xml] = await Promise.all([
    get_or_fetch_metadata(
      env,
      "minecraft/maven/neoforge/releases/net/neoforged/neoforge/maven-metadata.xml",
      `${NEOFORGE_MAVEN_ORIGIN}/releases/net/neoforged/neoforge/maven-metadata.xml`,
    ),
    get_or_fetch_metadata(
      env,
      "minecraft/maven/forge/net/minecraftforge/forge/maven-metadata.xml",
      `${FORGE_MAVEN_ORIGIN}/net/minecraftforge/forge/maven-metadata.xml`,
    ),
    get_or_fetch_metadata(
      env,
      "minecraft/maven/forge-legacy/net/minecraftforge/forge/maven-metadata.xml",
      `${FORGE_LEGACY_MAVEN_ORIGIN}/net/minecraftforge/forge/maven-metadata.xml`,
    ),
  ]);

  const neo_versions = neo_xml ? extract_maven_versions(neo_xml) : [];
  const forge_versions = forge_xml ? extract_maven_versions(forge_xml) : [];
  const legacy_versions = legacy_xml ? extract_maven_versions(legacy_xml) : [];

  for (const game of targets) {
    // NeoForge（1.20.1 及之后才有）
    const neo = latest_for_game(neo_versions, game);
    if (neo) {
      const path = `releases/net/neoforged/neoforge/${neo}/neoforge-${neo}-installer.jar`;
      await enqueue_artifact(
        env,
        `minecraft/maven/neoforge/${path}`,
        `${NEOFORGE_MAVEN_ORIGIN}/${path}`,
      );
    }

    // Forge：优先现代仓库，未命中再回退 legacy 仓库
    const forge = latest_for_game(forge_versions, game);
    if (forge) {
      const path = `net/minecraftforge/forge/${forge}/forge-${forge}-installer.jar`;
      await enqueue_artifact(env, `minecraft/maven/forge/${path}`, `${FORGE_MAVEN_ORIGIN}/${path}`);
      continue;
    }
    const legacy = latest_for_game(legacy_versions, game);
    if (legacy) {
      const path = `net/minecraftforge/forge/${legacy}/forge-${legacy}-installer.jar`;
      await enqueue_artifact(
        env,
        `minecraft/maven/forge-legacy/${path}`,
        `${FORGE_LEGACY_MAVEN_ORIGIN}/${path}`,
      );
    }
  }
}

// ── 入口 ────────────────────────────────────────────────

/** 30 分钟 cron：缓存模组加载器元数据并补充产物队列 */
export async function sync_modloaders(env: Env): Promise<void> {
  const targets = await loader_target_versions(env);
  if (targets.size === 0) return;

  await Promise.allSettled([sync_fabric(env, targets), sync_forge_family(env, targets)]);
}

/** 15 分钟 cron：从 modloader 队列逐批缓存加载器/安装器 JAR */
export async function process_modloader_queue(env: Env): Promise<void> {
  for (let i = 0; i < MODLOADER_BATCH_SIZE; i++) {
    const entry = await kv.pop_modloader_entry(env.GRANODIORITE_KV);
    if (!entry) break;

    let artifact: ModloaderArtifact;
    try {
      const parsed = JSON.parse(entry);
      if (
        typeof parsed !== "object" ||
        typeof parsed.key !== "string" ||
        typeof parsed.url !== "string"
      ) {
        throw new TypeError("Not a valid modloader queue entry");
      }
      artifact = parsed as ModloaderArtifact;
    } catch {
      console.error({ event: "MODLOADER_BAD_ENTRY", entry });
      continue;
    }

    // 已在缓存中（例如按需请求刚写入），丢弃
    const existing = await r2.head(env.MIRROR_BUCKET, artifact.key);
    if (existing) continue;

    try {
      const res = await fetch_file(artifact.url);
      if (!res.ok || !res.body) {
        throw new Error(`Failed to fetch ${artifact.url}: ${res.status}`);
      }
      await r2.put_stream(
        env.MIRROR_BUCKET,
        artifact.key,
        res.body,
        res.headers.get("Content-Type") ?? undefined,
      );
      console.log({ event: "MODLOADER_CACHED", key: artifact.key, url: artifact.url });
    } catch (e) {
      console.error({ event: "MODLOADER_FAILED", key: artifact.key, error: String(e) });
      await kv.push_modloader_entry(env.GRANODIORITE_KV, entry);
    }
  }
}
