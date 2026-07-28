/// Granodiorite 完整性校验脚本
///
/// 校验 R2 中文件的 SHA1 完整性和存在性。
/// 用法: deno -A scripts/verify.ts [version_id...]
///
/// 如果不指定版本 ID，则校验所有已知版本。

import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";

// ── 配置 ─────────────────────────────────────────────────

const R2_S3_ENDPOINT =
  Deno.env.get("R2_S3_ENDPOINT") ?? "https://<account-id>.r2.cloudflarestorage.com";
const R2_ACCESS_KEY = Deno.env.get("R2_ACCESS_KEY") ?? "";
const R2_SECRET_KEY = Deno.env.get("R2_SECRET_KEY") ?? "";
const BUCKET_NAME = "granodiorite-mirror";

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

async function sha1_of_stream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total_length = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total_length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const hash = await crypto.subtle.digest("SHA-1", merged.buffer);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── 校验 ─────────────────────────────────────────────────

let total_files = 0;
let passed = 0;
let failed = 0;

async function verify_file(key: string): Promise<void> {
  total_files++;
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
    const obj = await s3.send(cmd);
    if (!obj.Body) {
      console.error(`❌  EMPTY: ${key}`);
      failed++;
      return;
    }

    // 如果是 assets 对象，文件名本身就是 hash
    if (key.startsWith("minecraft/assets/") && key.length > 20) {
      const hash_in_path = key.split("/").pop()!;
      const sha1 = await sha1_of_stream(obj.Body as ReadableStream<Uint8Array>);
      if (sha1 === hash_in_path) {
        passed++;
      } else {
        console.error(`❌  HASH MISMATCH: ${key} (expected ${hash_in_path}, got ${sha1})`);
        failed++;
      }
    } else {
      // 其他文件：只验证存在性
      passed++;
    }
  } catch (e) {
    console.error(`❌  ERROR: ${key} —`, e);
    failed++;
  }
}

async function list_and_verify(prefix?: string): Promise<void> {
  let continuation_token: string | undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuation_token,
    });
    const result = await s3.send(cmd);

    if (result.Contents) {
      for (const obj of result.Contents) {
        if (obj.Key) await verify_file(obj.Key);
      }
    }

    continuation_token = result.NextContinuationToken;
  } while (continuation_token);
}

// ── 主流程 ───────────────────────────────────────────────

async function main() {
  const args = Deno.args;

  console.log("🔍 Granodiorite Verification Script");
  console.log(`📦 Bucket: ${BUCKET_NAME}`);

  if (args.length > 0) {
    for (const version_id of args) {
      console.log(`\n📦 Checking version: ${version_id}`);
      await list_and_verify(`minecraft/versions/${version_id}.json`);
      await list_and_verify(`minecraft/clients/${version_id}.jar`);
    }
  } else {
    console.log("\n📦 Checking all files...");
    await list_and_verify("minecraft/");
  }

  console.log(`\n📊 Results: ${total_files} total, ${passed} passed, ${failed} failed`);
  if (failed > 0) Deno.exit(1);
}

if (import.meta.main) {
  try {
    await main();
  } catch (e) {
    console.log(e);
  }
}
