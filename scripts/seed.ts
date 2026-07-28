/// Granodiorite 种子脚本
///
/// 初始部署时批量同步重要版本到 R2。
/// 用法: deno -A scripts/seed.ts
///
/// 注意: 需要先配置 wrangler.jsonc 中的 R2 和 KV 绑定，
/// 并在运行前设置好 Cloudflare 认证。

import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// ── 配置 ─────────────────────────────────────────────────

const R2_S3_ENDPOINT =
  Deno.env.get("R2_S3_ENDPOINT") ?? "https://<account-id>.r2.cloudflarestorage.com";
const R2_ACCESS_KEY = Deno.env.get("R2_ACCESS_KEY") ?? "";
const R2_SECRET_KEY = Deno.env.get("R2_SECRET_KEY") ?? "";
const BUCKET_NAME = "granodiorite-mirror";

const HIGH_PRIORITY_VERSIONS = [
  "1.7.10",
  "1.8.9",
  "1.12.2",
  "1.16.5",
  "1.18.2",
  "1.20.1",
  "1.21.1",
  "26.2",
];

// ── 客户端 ───────────────────────────────────────────────

const s3 = new S3Client({
  region: "auto",
  endpoint: R2_S3_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

// ── 工具 ─────────────────────────────────────────────────

async function object_exists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function download_and_upload(origin_url: string, r2_key: string): Promise<void> {
  if (await object_exists(r2_key)) {
    console.log(`  ⏭  Already cached: ${r2_key}`);
    return;
  }

  console.log(`  ⬇  Downloading: ${origin_url}`);
  const res = await fetch(origin_url);
  if (!res.ok) {
    console.error(`  ❌  Failed: ${origin_url} (${res.status})`);
    return;
  }

  const body = await res.arrayBuffer();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: r2_key,
      Body: new Uint8Array(body),
      ContentType: res.headers.get("Content-Type") ?? "application/octet-stream",
    }),
  );
  console.log(`  ✅  Cached: ${r2_key}`);
}

// ── 同步 ─────────────────────────────────────────────────

async function sync_version(version_id: string): Promise<void> {
  console.log(`\n📦 Syncing version: ${version_id}`);

  // 1. Version JSON
  const v_json_url = `https://launchermeta.mojang.com/v1/packages/${version_id}/${version_id}.json`;
  const v_key = `minecraft/versions/${version_id}.json`;
  await download_and_upload(v_json_url, v_key);

  // 2. 下载 version.json 以解析 dependencies
  const res = await fetch(v_json_url);
  if (!res.ok) {
    console.error(`  ❌  Failed to fetch version json: ${v_json_url}`);
    return;
  }
  const version_json = (await res.json()) as {
    downloads?: { client?: { url: string } };
    asset_index?: { id: string; url: string };
  };

  // 3. Client JAR
  const client = version_json.downloads?.client;
  if (client) {
    const client_key = `minecraft/clients/${version_id}.jar`;
    await download_and_upload(client.url, client_key);
  }

  // 4. Asset index
  const assetIndex = version_json.asset_index;
  if (assetIndex) {
    const ai_key = `minecraft/assets/indexes/${assetIndex.id}.json`;
    await download_and_upload(assetIndex.url, ai_key);

    // 5. Assets
    const ai_res = await fetch(assetIndex.url);
    if (ai_res.ok) {
      const asset_list = (await ai_res.json()) as {
        objects: Record<string, { hash: string; size: number }>;
      };
      const entries = Object.entries(asset_list.objects);
      console.log(`  📎  ${entries.length} assets to process`);

      let count = 0;
      for (const [, obj] of entries) {
        const hash = obj.hash;
        const asset_key = `minecraft/assets/${hash.slice(0, 2)}/${hash}`;
        const asset_url = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
        await download_and_upload(asset_url, asset_key);
        count++;
        if (count >= 2000) {
          console.log("  ⏸  Pausing after 2000 assets (resume on next run)");
          break;
        }
      }
      console.log(`  ✅  Synced ${count} assets`);
    }
  }
}

// ── 主流程 ───────────────────────────────────────────────

async function main() {
  console.log("🌱 Granodiorite Seed Script");
  console.log(`📦 Bucket: ${BUCKET_NAME}`);
  console.log(`🎯 Versions: ${HIGH_PRIORITY_VERSIONS.join(", ")}`);

  for (const version_id of HIGH_PRIORITY_VERSIONS) {
    await sync_version(version_id);
  }

  console.log("\n✅ Seed complete!");
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.error(e);
  }
}
