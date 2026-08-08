# Granodiorite — Copilot Instructions

## Build, lint, format commands

Commands use `deno task` (defined in `deno.jsonc`). `package.json` scripts are NOT used.

```sh
deno task check    # Type-check Worker source (uses Deno's TypeScript compiler)
deno task lint     # Run Oxlint on src/
deno task fmt      # Run Oxfmt on src/
deno task fmt-check # Check formatting without modifying
deno task dev      # Start Wrangler dev server (localhost)
deno task deploy   # Deploy to Cloudflare Workers
deno task types    # Regenerate worker-configuration.d.ts from wrangler.jsonc
```

Scripts in `scripts/` are Deno scripts (not Worker code):

```sh
deno task seed     # Batch-sync high-priority Minecraft versions to R2
deno task verify   # Verify SHA-1 integrity of files in R2
```

Individual Oxlint on a single file: `dx oxlint src/routes.ts -f agent`

Type-check a single script: `deno check scripts/seed.ts`

Since the codebase is stable at the "zero warnings" level, running `deno task lint` and `deno task check` at the project level is sufficient in most cases.

### CI pipeline

On every push, GitHub Actions (`.github/workflows/ci.yml`) runs: `install → check → lint → fmt-check`.

## Architecture

### Module map

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Dual handler export: `fetch` (HTTP) + `scheduled` (cron) |
| `src/serve.ts` | Request dispatch: R2 lookup, transparent proxy with `tee()`, on-demand precache |
| `src/routes.ts` | URL path → `Resource` discriminated union via chained `match_*` functions |
| `src/sync.ts` | Cron-driven sync: version manifest diff, queue management, full version download |
| `src/modloaders.ts` | Modloader metadata sync + artifact queue drain (Fabric/NeoForge/Forge) |
| `src/mojang.ts` | HTTP client for Mojang/modloader origins (ETag support, SHA-1 verification) |
| `src/kv.ts` | KV queue operations (FIFO arrays), sync status, manifest cache |
| `src/r2.ts` | R2 bucket wrapper: `head`, `get`, `put`, `put_stream`, `del`, `list` |
| `src/utils.ts` | Key/path helpers (`asset_storage_key`, `version_json_key`, etc.) and SHA-1 utilities |
| `src/types.ts` | All interfaces: `VersionManifest`, `Resource` (discriminated union), `SyncStatus`, etc. |

### Dual handler Worker

`src/index.ts` exports two handlers via `satisfies ExportedHandler<Env>`:

- **`fetch(request)`** — HTTP serving. Routes requests, checks R2, returns 302 redirect to public bucket on hit, or proxies from Mojang origin on miss (transparent proxy with `ReadableStream.tee()` → writes to R2 in background while returning to client).
- **`scheduled(controller)`** — Cron-driven sync. Two cron triggers distinguished by `controller.cron`:
  - `*/30 * * * *` → `sync_version_manifest()` + `sync_modloaders()`: fetches `version_manifest_v2.json`, detects new versions, enqueues them by type; caches modloader metadata (Fabric meta, Forge/NeoForge maven-metadata.xml) and enqueues latest loader/installer JARs.
  - `*/15 * * * *` → `process_sync_queue()` + `process_modloader_queue()`: drains high/medium/lazy version queues (3/1/1 per run — lazy is slowly consumed by cron toward full caching) and 2 modloader artifacts per run.

### Request flow

```
Request → routes.ts (URL → Resource) → r2.head() → hit? → ≤1MiB? → stream from Worker
                                                     │          └ >1MiB? → 302 to public R2 bucket
                                                     miss? → download lock acquired? → fetch origin → tee() → write R2 (bg) + return
                                                                   └ lock busy → passthrough only, no R2 write
```

Key details:
- **Small file threshold** (`SMALL_FILE_THRESHOLD = 1 MiB`): files ≤1MiB are served directly from Worker memory to avoid TLS handshake overhead of a redirect. Larger files get a 302 to the public R2 bucket.
- **Download lock** (`try_acquire_lock`): KV TTL lock (120s) per R2 key prevents concurrent duplicate downloads. If the lock is held by another request, the response passes through without writing to R2.
- **Version JSON miss triggers full precache**: `proxy_version_json()` catches version JSON cache misses, reads the JSON entirely (needed to parse), writes it to R2, then spawns a background `precache_version()` that also downloads: client JAR, server JAR, asset index, and up to 500 asset objects.

### Storage

- **R2 bucket `granodiorite-apac`** — All Minecraft files under `minecraft/` prefix. Public domain `r2.granodiorite.ferris.love` maps directly to this bucket.
- **KV namespace `GRANODIORITE_KV`** — Three priority queues (`sync:queue:high/medium/lazy`) plus a modloader artifact queue (`sync:queue:modloader`), per-version sync statuses (`sync:status:<id>`), known version list, version manifest ETag cache, download locks (`dl:lock:<r2_key>`).

### URL routing (`src/routes.ts`)

Nine path patterns split into small `match_*` functions chained via `??`:

| Path | Origin |
| --- | --- |
| `/version_manifest` or `/mc/game/version_manifest_v2.json` | launchermeta.mojang.com |
| `/assets/<pre2>/<hash>` | resources.download.minecraft.net |
| `/libraries/<path>` | libraries.minecraft.net |
| `/maven/fabric/<path>` | maven.fabricmc.net |
| `/maven/neoforge/<path>` | maven.neoforged.net |
| `/maven/forge/<path>` | maven.minecraftforge.net |
| `/maven/forge-legacy/<path>` | files.minecraftforge.net/maven |
| `/fabric-meta/<path>` | meta.fabricmc.net |
| `/v1/packages/<sha1>/<id>.json` | launchermeta.mojang.com |
| `/versions/<id>/<id>.jar` | dynamic (resolved from version.json) |
| `/assets/indexes/<id>.json` | launchermeta.mojang.com |

### Sync priority levels

- **High** (cron active): 1.7.10, 1.8.9, 1.12.2, 1.16.5, 1.18.2, 1.20.1, 1.21.1, latest release
- **Medium** (cron slow): other release versions
- **Low** (cron slow): snapshots, pre-releases, old alpha/beta — drained by cron at 1 version per run; also synced on demand when a user requests them

### Two precache paths

1. **Cron sync** (`sync_single_version` in `sync.ts`): pulls version.json, client JAR, asset index, and up to 500 asset objects per version. Runs every 15 min (3 high + 1 medium + 1 lazy per run).
2. **On-demand precache** (`precache_version` in `serve.ts`): triggered when a user's request misses R2 for a version JSON. Caches client JAR, server JAR, asset index, and up to 500 asset objects. This is how lazy-priority versions get cached.

## Key conventions

### Naming (Rust-style)

This project follows the same rules as Aphanite (the sibling project). These rules apply to **all identifiers authored in this project**:

| Category | Rule | Example |
| --- | --- | --- |
| Variables, function names, methods | `snake_case` | `fetch_version_manifest()`, `handle_request` |
| Constants, static globals | `SCREAMING_SNAKE_CASE` | `HIGH_PRIORITY_VERSIONS`, `VERSION_MANIFEST_ORIGIN` |
| Types, interfaces, classes, enums, enum variants | `PascalCase` | `VersionManifest`, `VersionType` |
| Pure TypeScript / config files | `kebab-case` | `worker-configuration.d.ts`, `wrangler.jsonc` |

Imported foreign identifiers (e.g., `ExecutionContext`, `FetchOptions` from Cloudflare types or npm packages) are NEVER renamed to match these conventions.

### Import style

Use `.ts` extensions in imports (allowed by `allowImportingTsExtensions: true` in tsconfig):

```ts
import { handle_request } from "./serve.ts";
import * as r2 from "./r2.ts";
```

### Doc comments

Use JSDoc `/** ... */` format (either single-line or multi-line blocks). Not `///`.

### Logging

Use `console.log` / `console.error` with structured JSON objects (not string interpolation):

```ts
console.log({ event: "PRECACHE_CLIENT_DONE", version: version_id });
```

### Toolchain

- **Type checking**: `deno check` (Worker + scripts), NOT `tsc`. Deno is configured via `deno.jsonc` (with `compilerOptions.types` pointing to `worker-configuration.d.ts` for Worker globals like `Request`, `R2Bucket`, `KVNamespace`).
- **Linting**: Oxlint via `oxlint.config.ts`. Several TS rules are disabled because they conflict with Workers patterns: `prefer-readonly-parameter-types`, `strict-boolean-expressions`, `no-unsafe-type-assertion`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`. Linting skips `scripts/`.
- **Formatting**: Oxfmt via `oxfmt.config.ts`. Features: `sortImports: true`, `arrowParens: "avoid"`, JSDoc formatting enabled. Covers JS/TS/JSON/JSONC/Markdown/YAML. Trailing commas disabled for JSONC, prose wrap disabled for Markdown.
- **Worker dev**: Wrangler CLI (`wrangler dev` / `wrangler deploy`).
- **Scripts**: Deno (`deno run -A scripts/xxx.ts`). Scripts use npm packages from `node_modules` (managed by Deno's `nodeModulesDir: "auto"`). `seed.ts` uses `@aws-sdk/client-s3` for S3-compatible R2 access; `verify.ts` checks SHA-1 integrity of asset files in R2.
- **Editor**: The `.zed/settings.json` configures Zed with Deno LSP, oxlint (onType), and oxfmt (onSave), disabling TypeScript/VTSL/ESLint.
