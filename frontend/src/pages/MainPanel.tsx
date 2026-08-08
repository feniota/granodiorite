import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart.tsx";
import { use_overview, use_timeline, use_type_breakdown, format_bytes, format_count } from "@/hooks/use-api.ts";
import { use_theme } from "@/hooks/use-theme.ts";
import type { TimelinePoint, TypeBreakdown } from "@/hooks/use-api.ts";
import { XAxis, YAxis, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import {
  RiDownload2Line,
  RiDatabase2Line,
  RiPieChartLine,
  RiExternalLinkLine,
  RiSunLine,
  RiMoonLine,
} from "@remixicon/react";

// ── 工具函数 ───────────────────────────────────────────

function format_date(date_str: string): string {
  const d = new Date(date_str + "T00:00:00Z");
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/** 资源类型 → 显示名 */
const ROUTE_TYPE_LABELS: Record<string, string> = {
  version_manifest: "版本清单",
  version_json: "版本 JSON",
  client_jar: "客户端 JAR",
  server_jar: "服务端 JAR",
  asset: "资源对象",
  library: "原版库文件",
  asset_index: "资源索引",
  fabric_maven: "Fabric Maven",
  fabric_meta: "Fabric Meta",
  neoforge_maven: "NeoForge Maven",
  forge_maven: "Forge Maven",
  forge_legacy_maven: "Forge Legacy",
};

function route_type_label(route_type: string): string {
  return ROUTE_TYPE_LABELS[route_type] ?? route_type;
}

// ── StatCard ───────────────────────────────────────────

function StatCard({
  title,
  value,
  icon,
  description,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── 图表组件 ───────────────────────────────────────────

function TimelineChart({ data }: { data: TimelinePoint[] }) {
  const chart_config = {
    count: { label: "请求数", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>下载量趋势</CardTitle>
        <CardDescription>最近 30 天每日下载请求数</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chart_config} className="h-72 w-full">
          <LineChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={format_date}
            />
            <YAxis tickLine={false} axisLine={false} tickFormatter={format_count} />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(label: React.ReactNode) => format_date(String(label))}
                  formatter={(value: unknown) => [format_count(Number(value)), "请求数"]}
                />
              }
            />
            <Line
              dataKey="count"
              type="monotone"
              stroke="var(--color-count)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function TypeBreakdownChart({ data }: { data: TypeBreakdown[] }) {
  const chart_config = Object.fromEntries(
    data.map((d, i) => [
      d.route_type,
      { label: route_type_label(d.route_type), color: `var(--chart-${(i % 5) + 1})` },
    ]),
  ) satisfies ChartConfig;

  const pie_data = data.map((d, i) => ({
    name: d.route_type,
    value: d.hit_count + d.miss_count,
    fill: `var(--chart-${(i % 5) + 1})`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>资源类型分布</CardTitle>
        <CardDescription>各资源类型的请求量占比</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chart_config} className="h-72 w-full">
          <PieChart>
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value: unknown, name: unknown) => [
                    format_count(Number(value)),
                    route_type_label(String(name)),
                  ]}
                />
              }
            />
            <Pie
              data={pie_data}
              dataKey="value"
              nameKey="name"
              innerRadius={60}
              strokeWidth={2}
            >
              {pie_data.map(entry => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <ChartLegend
              content={<ChartLegendContent nameKey="name" />}
              className="flex-wrap"
            />
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

// ── Loading / Error ────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[1, 2, 3].map(i => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── 主面板 ─────────────────────────────────────────────

export default function MainPanel() {
  const { data: overview, loading: ov_loading, error: ov_error } = use_overview();
  const { data: timeline, loading: tl_loading, error: tl_error } = use_timeline();
  const { data: breakdown, loading: br_loading, error: br_error } = use_type_breakdown();
  const { theme, toggle } = use_theme();

  const loading = ov_loading && tl_loading && br_loading;

  return (
    <div className="min-h-screen bg-background">
      {/* 顶栏 */}
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-heading font-bold tracking-tight">
              Granodiorite
            </h1>
            <p className="text-muted-foreground mt-1">
              Minecraft 资源镜像站 — 下载统计面板
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="切换主题">
            {theme === "dark" ? (
              <RiSunLine />
            ) : (
              <RiMoonLine />
            )}
          </Button>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* 统计卡片 */}
        {ov_error ? (
          <div className="text-destructive text-sm">加载失败: {ov_error}</div>
        ) : loading ? (
          <LoadingSkeleton />
        ) : overview ? (
          <div className="grid gap-4 md:grid-cols-3">
            <StatCard
              title="总请求数"
              value={format_count(overview.total_requests)}
              icon={<RiDownload2Line className="size-5" />}
            />
            <StatCard
              title="总流量"
              value={format_bytes(overview.total_bytes)}
              icon={<RiDatabase2Line className="size-5" />}
            />
            <StatCard
              title="缓存命中率"
              value={`${(overview.hit_rate * 100).toFixed(1)}%`}
              icon={<RiPieChartLine className="size-5" />}
              description={
                overview.hit_rate > 0.8
                  ? "缓存效果良好"
                  : overview.hit_rate > 0.5
                  ? "缓存效果一般"
                  : "缓存率偏低，同步进行中"
              }
            />
          </div>
        ) : null}

        {/* 图表 */}
        {tl_error ? (
          <div className="text-destructive text-sm">加载失败: {tl_error}</div>
        ) : timeline && timeline.length > 0 ? (
          <TimelineChart data={timeline} />
        ) : null}

        {br_error ? (
          <div className="text-destructive text-sm">加载失败: {br_error}</div>
        ) : breakdown && breakdown.length > 0 ? (
          <TypeBreakdownChart data={breakdown} />
        ) : null}
      </main>

      {/* 底部 */}
      <footer className="border-t mt-12">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground space-x-4">
          <span>Granodiorite &copy; {new Date().getFullYear()}</span>
          <Separator orientation="vertical" className="inline-block h-4 w-px" />
          <a
            href="https://phenocryst.ferris.love/granodiorite/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            项目介绍
            <RiExternalLinkLine className="size-3" />
          </a>
          <Separator orientation="vertical" className="inline-block h-4 w-px" />
          <a
            href="https://phenocryst.ferris.love/granodiorite/terms.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:underline"
          >
            服务条款
            <RiExternalLinkLine className="size-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}
