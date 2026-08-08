// ── Minecraft 资源类型定义 ─────────────────────────────────

/** 版本清单（version_manifest_v2.json） */
export interface VersionIndex {
  latest: {
    release: string;
    snapshot: string;
  };
  versions: Version[];
}

/** 版本清单中的单个版本条目 */
export interface Version {
  id: string;
  type: VersionType;
  url: string;
  time: string;
  release_time: string;
  sha1: string;
  compliance_level: number;
}

export type VersionType = "release" | "snapshot" | "old_beta" | "old_alpha";

/** 单个版本的详细描述（version.json） */
export interface VersionManifest {
  id: string;
  type: string;
  time: string;
  release_time: string;
  main_class: string;
  minimum_launcher_version?: number;
  arguments?: Arguments;
  asset_index: AssetIndex;
  downloads: Downloads;
  java_version?: JavaVersion;
  libraries: Library[];
  logging?: Logging;
  minecraft_arguments?: string;
  [key: string]: unknown;
}

export interface Arguments {
  game?: Argument[];
  jvm?: Argument[];
}

export type Argument = string | ArgumentEntry;

export interface ArgumentEntry {
  rules?: Rule[];
  value: string | string[];
}

export interface Rule {
  action: "allow" | "disallow";
  os?: {
    name?: string;
    arch?: string;
    version?: string;
  };
  features?: Record<string, boolean>;
}

export interface AssetIndex {
  id: string;
  sha1: string;
  size: number;
  total_size?: number;
  url: string;
}

export interface AssetIndexList {
  objects: Record<string, AssetObject>;
  [key: string]: unknown;
}

export interface AssetObject {
  hash: string;
  size: number;
}

export interface Downloads {
  client?: Download;
  server?: Download;
}

export interface Download {
  sha1: string;
  size: number;
  url: string;
}

export interface JavaVersion {
  component: string;
  major_version: number;
}

export interface Library {
  name: string;
  downloads?: LibraryDownloads;
  rules?: Rule[];
  natives?: Record<string, string>;
  extract?: Extract;
}

export interface LibraryDownloads {
  artifact?: Artifact;
  classifiers?: Record<string, Artifact>;
}

export interface Artifact {
  path: string;
  url: string;
  sha1: string;
  size: number;
}

export interface Extract {
  exclude?: string[];
}

export interface Logging {
  client?: LoggingConfig;
}

export interface LoggingConfig {
  argument: string;
  file: LoggingFile;
  type: string;
}

export interface LoggingFile {
  id: string;
  sha1: string;
  size: number;
  url: string;
}

// ── 镜像系统类型 ──────────────────────────────────────────

/** 路由解析结果：描述一个请求应该如何处理 */
export type Resource =
  | { type: "version_manifest"; r2_key: string; origin_url: string }
  | { type: "version_json"; version_id: string; r2_key: string; origin_url: string }
  | { type: "client_jar"; version_id: string; r2_key: string; origin_url: string }
  | { type: "server_jar"; version_id: string; r2_key: string; origin_url: string }
  | { type: "asset"; hash: string; r2_key: string; origin_url: string }
  | { type: "library"; r2_key: string; origin_url: string }
  | { type: "fabric_maven"; r2_key: string; origin_url: string }
  | { type: "fabric_meta"; r2_key: string; origin_url: string }
  | { type: "neoforge_maven"; r2_key: string; origin_url: string }
  | { type: "forge_maven"; r2_key: string; origin_url: string }
  | { type: "forge_legacy_maven"; r2_key: string; origin_url: string }
  | { type: "asset_index"; id: string; r2_key: string; origin_url: string };

/** 版本同步状态 */
export type SyncStatus = "not_started" | "in_progress" | "complete" | "partial" | "failed";

/** 同步队列优先级 */
export type QueuePriority = "high" | "medium" | "lazy";

/** 模组加载器产物队列条目：待缓存的 R2 key 与源站 URL */
export interface ModloaderArtifact {
  key: string;
  url: string;
}
