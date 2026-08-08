import { sync_modloaders, process_modloader_queue } from "./modloaders.ts";
import { handle_request } from "./serve.ts";
import { sync_version_manifest, process_sync_queue } from "./sync.ts";

/**
 * Granodiorite — Minecraft 资源镜像站 - `fetch`: 处理 HTTP 请求（文件服务 + 透明代理） - `scheduled`: 处理 Cron
 * 触发器（后台同步）
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle_request(request, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    switch (controller.cron) {
      case "*/30 * * * *":
        await sync_version_manifest(env);
        await sync_modloaders(env);
        break;
      case "*/15 * * * *":
        await process_sync_queue(env);
        await process_modloader_queue(env);
        break;
      default:
        console.warn({ event: "UNKNOWN_CRON", cron: controller.cron });
    }
  },
} satisfies ExportedHandler<Env>;
