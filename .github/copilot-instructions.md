# Granodiorite — Copilot Instructions

## Build, lint, format commands

Commands use `deno task` (defined in `deno.jsonc`). `package.json` scripts are NOT used.

```sh
deno task check    # Type-check Worker source (uses Deno's TypeScript compiler)
deno task lint     # Run Oxlint on src/
deno task fmt      # Run Oxfmt on src/
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

## Architecture

### Dual handler Worker

`src/index.ts` exports two handlers via `satisfies ExportedHandler<Env>`:

- **`fetch(request)`** — HTTP serving. Routes requests, checks R2, returns 302 redirect to public bucket on hit, or proxies from Mojang origin on miss (transparent proxy with `ReadableStream.tee()` → writes to R2 in background while returning to client).
- **`scheduled(controller)`** — Cron-driven sync. Two cron triggers distinguished by `controller.cron`:
  - `*/30 * * * *` → `sync_version_manifest()`: fetches `version_manifest_v2.json`, detects new versions, enqueues them by type.
  - `*/15 * * * *` → `process_sync_queue()`: processes high/medium priority queues (1-3 versions per run).

### Request flow

```
Request → routes.ts (URL → Resource) → r2.head() → hit? → 302 to public R2 bucket
                                                    miss? → fetch origin → tee() → write R2 + return to client
```

### Storage

- **R2 bucket `granodiorite-mirror`** — All Minecraft files under `minecraft/` prefix. Public domain `r2.granodiorite.ferris.love` maps directly to this bucket.
- **KV namespace `GRANODIORITE_KV`** — Three priority queues (`sync:queue:high/medium/lazy`), per-version sync statuses (`sync:status:<id>`), known version list, version manifest ETag cache.

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
- **Low** (lazy-only): snapshots, pre-releases, old alpha/beta — synced only when a user requests them

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

### Toolchain

- **Type checking**: `deno check` (Worker + scripts), NOT `tsc`. Deno is configured via `deno.jsonc` (with `compilerOptions.types` pointing to `worker-configuration.d.ts` for Worker globals like `Request`, `R2Bucket`, `KVNamespace`).
- **Linting**: Oxlint via `oxlint.config.ts`. Some TypeScript rules are disabled because they conflict with Workers patterns (`prefer-readonly-parameter-types`, `strict-boolean-expressions`, `no-unsafe-type-assertion`).
- **Formatting**: Oxfmt via `oxfmt.config.ts`. Features: `sortImports: true`, `arrowParens: "avoid"`, JSDoc formatting enabled.
- **Worker dev**: Wrangler CLI (`wrangler dev` / `wrangler deploy`).
- **Scripts**: Deno (`deno run -A scripts/xxx.ts`). Scripts use npm packages from `node_modules` (managed by Deno's `nodeModulesDir: "auto"`).
