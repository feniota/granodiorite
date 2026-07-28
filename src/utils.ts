/** SHA-1 哈希工具 */
export async function sha1_hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", data);
  return hex_from_buffer(hash);
}

export function hex_from_buffer(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** 对象存储路径工具 */
export function asset_storage_key(hash: string): string {
  return `minecraft/assets/${hash.slice(0, 2)}/${hash}`;
}

export function version_json_key(version_id: string): string {
  return `minecraft/versions/${version_id}.json`;
}

export function client_jar_key(version_id: string): string {
  return `minecraft/clients/${version_id}.jar`;
}

export function server_jar_key(version_id: string): string {
  return `minecraft/servers/${version_id}.jar`;
}

export function asset_index_key(asset_id: string): string {
  return `minecraft/assets/indexes/${asset_id}.json`;
}

export function library_key(maven_path: string): string {
  return `minecraft/libraries/${maven_path}`;
}

export function version_manifest_key(): string {
  return "minecraft/version_manifest_v2.json";
}

/** KV 状态键 */
export function sync_status_key(version_id: string): string {
  return `sync:status:${version_id}`;
}
