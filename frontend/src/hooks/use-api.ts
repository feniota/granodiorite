import { useState, useEffect, useCallback } from "react";

// ── 类型定义 ───────────────────────────────────────────

export interface Overview {
  total_requests: number;
  total_bytes: number;
  hit_rate: number;
}

export interface TimelinePoint {
  date: string;
  count: number;
  bytes: number;
}

export interface TypeBreakdown {
  route_type: string;
  hit_count: number;
  miss_count: number;
  hit_bytes: number;
  miss_bytes: number;
}

export interface VersionEntry {
  id: string;
  type: string;
  status: string;
  time: string;
}

export interface VersionList {
  versions: VersionEntry[];
  next_cursor: string | null;
  total: number;
}

export interface QueueInfo {
  priority: string;
  length: number;
}

/** 通用 fetch 封装 */
async function fetch_json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ── 格式化工具（导出供共享） ──────────────────────────

export function format_bytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function format_count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── 公开 API ───────────────────────────────────────────

export function use_overview() {
  return use_api<Overview>("/api/v2/stats/overview");
}

export function use_timeline() {
  return use_api<TimelinePoint[]>("/api/v2/stats/timeline");
}

export function use_type_breakdown() {
  return use_api<TypeBreakdown[]>("/api/v2/stats/by-type");
}

function use_api<T>(url: string) {
  const [data, set_data] = useState<T | null>(null);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const fetch_data = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const result = await fetch_json<T>(url);
      set_data(result);
    } catch (e: unknown) {
      set_error(String(e));
    } finally {
      set_loading(false);
    }
  }, [url]);

  useEffect(() => {
    fetch_data();
    const interval = setInterval(fetch_data, 60_000);
    return () => clearInterval(interval);
  }, [fetch_data]);

  return { data, loading, error, refetch: fetch_data };
}

// ── 管理后台 API ───────────────────────────────────────

/** 构建管理 API URL */
function admin_url(uuid: string, path: string, params?: Record<string, string>): string {
  const url = new URL(`/${uuid}/api/${path}`, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

export function use_admin_versions(
  uuid: string,
  limit = 50,
  type?: string,
  status?: string,
) {
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [cursor, set_cursor] = useState<string | undefined>(undefined);
  const [all_versions, set_all_versions] = useState<VersionEntry[]>([]);
  const [total, set_total] = useState(0);

  const fetch_versions = useCallback(async (page_cursor?: string) => {
    set_loading(true);
    set_error(null);
    try {
      const result = await fetch_json<VersionList>(
        admin_url(uuid, "versions", {
          limit: String(limit),
          ...(type ? { type } : {}),
          ...(status ? { status } : {}),
          ...(page_cursor ? { cursor: page_cursor } : {}),
        }),
      );
      if (page_cursor) {
        set_all_versions(prev => [...prev, ...result.versions]);
      } else {
        set_all_versions(result.versions);
      }
      set_total(result.total);
      set_cursor(result.next_cursor ?? undefined);
    } catch (e: unknown) {
      set_error(String(e));
    } finally {
      set_loading(false);
    }
  }, [uuid, limit, type, status]);

  const load_more = useCallback(() => {
    if (cursor && !loading) {
      fetch_versions(cursor);
    }
  }, [cursor, loading, fetch_versions]);

  /** 本地更新某个版本的状态（同步触发成功后立即显示"同步中"） */
  const set_version_status = useCallback((version_id: string, status: string) => {
    set_all_versions(prev => prev.map(v => (v.id === version_id ? { ...v, status } : v)));
  }, []);

  useEffect(() => {
    set_all_versions([]);
    set_cursor(undefined);
    fetch_versions();
  }, [fetch_versions]);

  return {
    versions: all_versions,
    loading,
    error,
    has_more: !!cursor,
    load_more,
    total,
    set_version_status,
  };
}

export function use_admin_queues(uuid: string) {
  return use_api<QueueInfo[]>(admin_url(uuid, "versions/queue"));
}

export async function trigger_sync(uuid: string, version_id: string): Promise<{ success: boolean; message: string }> {
  return fetch_json(admin_url(uuid, "versions/sync", { id: version_id }), { method: "POST" });
}

export function use_admin_stats(uuid: string) {
  return use_api<{
    overview: Overview;
    timeline: TimelinePoint[];
    breakdown: TypeBreakdown[];
  }>(admin_url(uuid, "stats"));
}
