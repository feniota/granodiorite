import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { ScrollArea } from "@/components/ui/scroll-area.tsx";
import {
  use_admin_versions,
  use_admin_queues,
  use_admin_stats,
  trigger_sync,
  format_bytes,
  format_count,
} from "@/hooks/use-api.ts";
import { use_theme } from "@/hooks/use-theme.ts";
import {
  RiRefreshLine,
  RiPlayLine,
  RiTimeLine,
  RiBarChartLine,
  RiListCheck,
  RiSunLine,
  RiMoonLine,
} from "@remixicon/react";

// ── 状态徽章 ───────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> =
    {
      complete: { variant: "default", label: "已完成" },
      in_progress: { variant: "secondary", label: "同步中" },
      failed: { variant: "destructive", label: "失败" },
      partial: { variant: "outline", label: "部分完成" },
      not_started: { variant: "outline", label: "未开始" },
    };
  const c = config[status] ?? { variant: "outline" as const, label: status };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, "default" | "secondary" | "outline"> = {
    release: "default",
    snapshot: "secondary",
    old_beta: "outline",
    old_alpha: "outline",
  };
  return <Badge variant={colors[type] ?? "outline"}>{type}</Badge>;
}

// ── 版本管理页面 ───────────────────────────────────────

function VersionManager({
  uuid,
  set_search_term,
  on_synced,
}: {
  uuid: string;
  set_search_term: (s: string) => void;
  on_synced: () => void;
}) {
  const [type_filter, set_type_filter] = useState<string>("");
  const [status_filter, set_status_filter] = useState<string>("");
  const {
    versions,
    loading,
    error,
    has_more,
    load_more,
    total,
    set_version_status,
  } = use_admin_versions(uuid, 100, type_filter || undefined, status_filter || undefined);
  const [syncing_id, set_syncing_id] = useState<string | null>(null);
  const [sync_msg, set_sync_msg] = useState<string>("");

  async function handle_sync(version_id: string) {
    set_syncing_id(version_id);
    set_sync_msg("");
    try {
      const result = await trigger_sync(uuid, version_id);
      set_sync_msg(result.message);
      if (result.success) {
        // 服务端已入队并标记 in_progress：本地立即反映"同步中"，完成状态等刷新
        set_version_status(version_id, "in_progress");
        on_synced();
      }
    } catch (e: unknown) {
      set_sync_msg(`错误: ${String(e)}`);
    } finally {
      set_syncing_id(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>已知版本</CardTitle>
            <CardDescription>共 {total} 个版本</CardDescription>
          </div>
          <div className="flex gap-2">
            <Select
              value={type_filter}
              onValueChange={(v: string | null) => set_type_filter(v ?? "")}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部类型</SelectItem>
                <SelectItem value="release">Release</SelectItem>
                <SelectItem value="snapshot">Snapshot</SelectItem>
                <SelectItem value="old_beta">Old Beta</SelectItem>
                <SelectItem value="old_alpha">Old Alpha</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status_filter}
              onValueChange={(v: string | null) => set_status_filter(v ?? "")}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">全部状态</SelectItem>
                <SelectItem value="complete">已完成</SelectItem>
                <SelectItem value="not_started">未开始</SelectItem>
                <SelectItem value="in_progress">同步中</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <input
          type="text"
          placeholder="搜索版本..."
          onChange={e => set_search_term(e.target.value)}
          className="w-full mb-4 px-3 py-2 border rounded-md text-sm bg-background"
        />
        {error && <div className="text-destructive text-sm mb-4">{error}</div>}
        {sync_msg && (
          <div className="text-sm mb-4 text-muted-foreground bg-muted p-2 rounded">
            {sync_msg}
          </div>
        )}

        <ScrollArea className="h-[500px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>版本 ID</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>发布时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {versions.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-sm">{v.id}</TableCell>
                  <TableCell><TypeBadge type={v.type} /></TableCell>
                  <TableCell><StatusBadge status={v.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {v.time ? new Date(v.time).toLocaleDateString("zh-CN") : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handle_sync(v.id)}
                      disabled={syncing_id === v.id}
                    >
                      {syncing_id === v.id ? (
                        <>
                          <Spinner className="mr-1 size-3" />
                          同步中
                        </>
                      ) : (
                        <>
                          <RiPlayLine className="size-3 mr-1" />
                          同步
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>

        {has_more && (
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={load_more} disabled={loading}>
              {loading ? "加载中..." : "加载更多"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 同步队列卡片 ───────────────────────────────────────

function QueueCard({
  priority,
  length,
}: {
  priority: string;
  length: number;
}) {
  const priority_colors: Record<string, string> = {
    high: "text-destructive",
    medium: "text-amber-500",
    lazy: "text-muted-foreground",
    modloader: "text-sky-500",
  };
  const priority_labels: Record<string, string> = {
    high: "高优先级",
    medium: "中优先级",
    lazy: "低优先级 (慢速)",
    modloader: "模组加载器",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between">
          {priority_labels[priority] ?? priority}
          <RiTimeLine className={`size-4 ${priority_colors[priority] ?? ""}`} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{length}</div>
        <p className="text-xs text-muted-foreground mt-1">待同步版本数</p>
      </CardContent>
    </Card>
  );
}

// ── 管理统计 ───────────────────────────────────────────

function AdminStats({ uuid }: { uuid: string }) {
  const { data, loading, error } = use_admin_stats(uuid);

  if (loading) return <Skeleton className="h-40" />;
  if (error) return <div className="text-destructive text-sm">{error}</div>;
  if (!data) return null;

  const { overview, breakdown } = data;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">总请求</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {format_count(overview.total_requests)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">总流量</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {format_bytes(overview.total_bytes)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">缓存命中率</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {(overview.hit_rate * 100).toFixed(1)}%
          </CardContent>
        </Card>
      </div>

      {breakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">资源类型详情</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">命中</TableHead>
                  <TableHead className="text-right">未命中</TableHead>
                  <TableHead className="text-right">命中率</TableHead>
                  <TableHead className="text-right">命中流量</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map(b => {
                  const total = b.hit_count + b.miss_count;
                  const rate = total > 0 ? (b.hit_count / total * 100).toFixed(1) : "-";
                  return (
                    <TableRow key={b.route_type}>
                      <TableCell className="font-mono text-sm">{b.route_type}</TableCell>
                      <TableCell className="text-right">{format_count(b.hit_count)}</TableCell>
                      <TableCell className="text-right">{format_count(b.miss_count)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={Number(rate) > 80 ? "default" : "secondary"}>
                          {rate}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {format_bytes(b.hit_bytes)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── 后台面板主组件 ─────────────────────────────────────

export default function AdminPanel({ uuid }: { uuid: string }) {
  const [, set_search_term] = useState("");
  const {
    data: queues,
    loading: q_loading,
    refetch: refetch_queues,
  } = use_admin_queues(uuid);
  const { theme, toggle } = use_theme();

  return (
    <div className="min-h-screen bg-background">
      {/* 顶栏 */}
      <header className="border-b bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-heading font-bold">Granodiorite 管理面板</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              UUID: {uuid.slice(0, 8)}...
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label="切换主题"
            >
              {theme === "dark" ? <RiSunLine /> : <RiMoonLine />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RiRefreshLine className="size-3 mr-1" />
              刷新
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* 同步队列概览 */}
        <section>
          <h2 className="text-lg font-heading font-semibold mb-3 flex items-center gap-2">
            <RiTimeLine className="size-4" />
            同步队列
          </h2>
          {q_loading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {(queues ?? []).map(q => (
                <QueueCard key={q.priority} priority={q.priority} length={q.length} />
              ))}
            </div>
          )}
        </section>

        {/* 标签页 */}
        <Tabs defaultValue="versions">
          <TabsList>
            <TabsTrigger value="versions">
              <RiListCheck className="size-4 mr-1" />
              版本管理
            </TabsTrigger>
            <TabsTrigger value="stats">
              <RiBarChartLine className="size-4 mr-1" />
              统计
            </TabsTrigger>
          </TabsList>

          <TabsContent value="versions" className="mt-4">
            <VersionManager
              uuid={uuid}
              set_search_term={set_search_term}
              on_synced={refetch_queues}
            />
          </TabsContent>

          <TabsContent value="stats" className="mt-4">
            <AdminStats uuid={uuid} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
