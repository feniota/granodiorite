/** D1 数据库操作 —— 统计分析 */

// ── 建表 SQL（在首次部署时手动执行） ──────────────────────

export const SCHEMA_SQL = `
-- 小时级聚合统计（精确到小时，保留 48 小时后可汇总到 daily）
CREATE TABLE IF NOT EXISTS hourly_stats (
  hour TEXT NOT NULL,
  route_type TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, route_type, action)
);

-- 天级聚合统计（永久累积）
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT NOT NULL,
  route_type TEXT NOT NULL,
  action TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, route_type, action)
);
`;

// ── 追踪记录 ────────────────────────────────────────────

/** 记录一次下载/代理事件（UPSERT 聚合写入） */
export function track_hourly(
  db: D1Database,
  hour: string,
  route_type: string,
  action: string,
  bytes: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO hourly_stats (hour, route_type, action, count, bytes)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(hour, route_type, action)
       DO UPDATE SET count = count + 1, bytes = bytes + ?`,
    )
    .bind(hour, route_type, action, bytes, bytes);
}

// ── 每小时数据清洗 ──────────────────────────────────────

/** 将 48 小时前的 hour 数据汇总到 daily_stats，然后删除 */
async function rollup_hourly(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 13) + ":00:00Z";

  // 汇总到 daily
  await db
    .prepare(
      `INSERT INTO daily_stats (date, route_type, action, count, bytes)
       SELECT substr(hour, 1, 10), route_type, action, sum(count), sum(bytes)
       FROM hourly_stats
       WHERE hour < ?
       GROUP BY substr(hour, 1, 10), route_type, action
       ON CONFLICT(date, route_type, action)
       DO UPDATE SET count = daily_stats.count + excluded.count,
                     bytes = daily_stats.bytes + excluded.bytes`,
    )
    .bind(cutoff)
    .run();

  // 删除已汇总的旧小时数据
  await db.prepare("DELETE FROM hourly_stats WHERE hour < ?").bind(cutoff).run();
}

/** 惰性清洗：每 ~20 次调用才实际执行一次，避免每请求都查 DB */
let rollup_counter = 0;
const ROLLUP_INTERVAL = 20;

export async function maybe_rollup(db: D1Database): Promise<void> {
  rollup_counter++;
  if (rollup_counter >= ROLLUP_INTERVAL) {
    rollup_counter = 0;
    await rollup_hourly(db);
  }
}

// ── 查询 ────────────────────────────────────────────────

export interface TimelinePoint {
  date: string;
  count: number;
  bytes: number;
}

/** 每日下载趋势（最近 N 天，含 hourly + daily） */
export async function get_timeline(db: D1Database, days = 30): Promise<TimelinePoint[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 合并 daily + hourly（未汇总到 daily 的部分）
  const result = await db
    .prepare(
      `SELECT date, sum(count) as count, sum(bytes) as bytes FROM (
         SELECT date, count, bytes FROM daily_stats WHERE date >= ?
         UNION ALL
         SELECT substr(hour, 1, 10) as date, count, bytes
         FROM hourly_stats WHERE substr(hour, 1, 10) >= ?
       ) GROUP BY date ORDER BY date`,
    )
    .bind(since, since)
    .all<TimelinePoint>();

  return result.results ?? [];
}

export interface TypeBreakdown {
  route_type: string;
  hit_count: number;
  miss_count: number;
  hit_bytes: number;
  miss_bytes: number;
}

/** 按资源类型的缓存命中/未命中统计 */
export async function get_type_breakdown(db: D1Database): Promise<TypeBreakdown[]> {
  // 合并 daily + hourly
  const result = await db
    .prepare(
      `SELECT route_type, action, sum(count) as total, sum(bytes) as total_bytes FROM (
         SELECT route_type, action, count, bytes FROM daily_stats
         UNION ALL
         SELECT route_type, action, count, bytes FROM hourly_stats
       ) GROUP BY route_type, action ORDER BY route_type, action`,
    )
    .all<{ route_type: string; action: string; total: number; total_bytes: number }>();

  // 按 route_type 分组，把 hit/miss 分开
  const map = new Map<string, TypeBreakdown>();
  for (const row of result.results ?? []) {
    if (!map.has(row.route_type)) {
      map.set(row.route_type, {
        route_type: row.route_type,
        hit_count: 0,
        miss_count: 0,
        hit_bytes: 0,
        miss_bytes: 0,
      });
    }
    const entry = map.get(row.route_type)!;
    if (row.action === "hit") {
      entry.hit_count += row.total;
      entry.hit_bytes += row.total_bytes;
    } else {
      entry.miss_count += row.total;
      entry.miss_bytes += row.total_bytes;
    }
  }
  return Array.from(map.values());
}

/** 总览数据 */
export async function get_overview(
  db: D1Database,
): Promise<{ total_requests: number; total_bytes: number; hit_rate: number }> {
  const result = await db
    .prepare(
      `SELECT action, sum(count) as total, sum(bytes) as total_bytes FROM (
         SELECT action, count, bytes FROM daily_stats
         UNION ALL
         SELECT action, count, bytes FROM hourly_stats
       ) GROUP BY action`,
    )
    .all<{ action: string; total: number; total_bytes: number }>();

  let hit = 0;
  let miss = 0;
  let total_bytes = 0;
  for (const row of result.results ?? []) {
    if (row.action === "hit") {
      hit += row.total;
    } else {
      miss += row.total;
    }
    total_bytes += row.total_bytes;
  }
  const total_requests = hit + miss;
  return {
    total_requests,
    total_bytes,
    hit_rate: total_requests > 0 ? hit / total_requests : 0,
  };
}
