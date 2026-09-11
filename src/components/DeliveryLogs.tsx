import { useMemo, useState } from "react";
import { Activity, ChevronRight, Clock, Inbox, RotateCw, Search, Send, TimerReset, TrendingUp } from "lucide-react";
import { useStore } from "@/store";
import { Button, Card, EmptyState, formatDateTime, inputCls, StatCard, StatusBadge, Segmented, timeAgo } from "@/components/ui";
import { formatMs } from "@/lib/webhook";
import type { DeliveryLog } from "@/types";
import { LogDrawer } from "@/components/LogDrawer";
import { cn } from "@/utils/cn";

type Filter = "all" | "delivered" | "failed" | "retried";

export function DeliveryLogs() {
  const { state, setTab } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const logs = state.logs;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter === "delivered" && l.outcome !== "delivered") return false;
      if (filter === "failed" && l.outcome !== "failed") return false;
      if (filter === "retried" && l.retryCount === 0) return false;
      if (!q) return true;
      return [l.event, l.url, l.method, String(l.finalStatus), l.finalStatusText, l.id]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [logs, query, filter]);

  const stats = useMemo(() => {
    const total = logs.length;
    const delivered = logs.filter((l) => l.outcome === "delivered").length;
    const avg = total ? Math.round(logs.reduce((s, l) => s + l.latencyMs, 0) / total) : 0;
    const retries = logs.reduce((s, l) => s + l.retryCount, 0);
    return { total, rate: total ? Math.round((delivered / total) * 100) : 0, avg, retries };
  }, [logs]);

  const selected = logs.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Delivery Logs</h2>
        <p className="mt-1 text-sm text-slate-400">Every dispatch with its response, latency, retry history and HMAC signature. Select a row to inspect.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Dispatches" value={stats.total} icon={Activity} hint="Stored locally in this browser" accent="violet" />
        <StatCard label="Success rate" value={`${stats.rate}%`} icon={TrendingUp} accent="emerald" hint="2xx responses / total" />
        <StatCard label="Avg latency" value={formatMs(stats.avg)} icon={Clock} accent="slate" hint="Across final attempts" />
        <StatCard label="Total retries" value={stats.retries} icon={RotateCw} accent="amber" hint="Backoff re-sends issued" />
      </div>

      <Card flush>
        <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              aria-label="Search deliveries"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search event, endpoint, status…"
              className={cn(inputCls, "pl-9 font-mono text-[13px]")}
            />
          </div>
          <Segmented<Filter>
            options={[
              { value: "all", label: "All" },
              { value: "delivered", label: "Delivered" },
              { value: "failed", label: "Failed" },
              { value: "retried", label: "Retried" },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>

        {logs.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No deliveries recorded"
            text="Dispatch a webhook to start building your delivery history. Each attempt is captured with its signature and response."
            action={
              <Button variant="primary" icon={Send} onClick={() => setTab("dispatcher")}>
                Go to dispatcher
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No matching deliveries" text="Try a different search term or clear the filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-white/[0.02] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Endpoint</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Latency</th>
                  <th className="px-4 py-3 text-center">Retries</th>
                  <th className="px-4 py-3">Signature</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <LogRow key={log.id} log={log} onOpen={() => setSelectedId(log.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.length > 0 && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-xs text-slate-500">
            <span>
              Showing <span className="font-mono text-slate-300">{filtered.length}</span> of{" "}
              <span className="font-mono text-slate-300">{logs.length}</span>
            </span>
            <span className="hidden sm:inline">Click a row to open the response inspector</span>
          </div>
        )}
      </Card>

      {selected && <LogDrawer key={selected.id} log={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function LogRow({ log, onOpen }: { log: DeliveryLog; onOpen: () => void }) {
  return (
    <tr
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer border-t border-white/[0.04] transition hover:bg-white/[0.03] focus:bg-white/[0.04] focus:outline-none"
    >
      <td className="whitespace-nowrap px-4 py-3">
        <div className="font-mono text-xs text-slate-300">{formatDateTime(log.timestamp)}</div>
        <div className="text-[11px] text-slate-500">{timeAgo(log.timestamp)}</div>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs font-medium text-violet-300">{log.event}</span>
      </td>
      <td className="max-w-[260px] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">{log.method}</span>
          <span className="truncate font-mono text-xs text-slate-400" title={log.url}>
            {log.url}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <StatusBadge status={log.finalStatus} statusText={log.finalStatusText} />
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs text-slate-200">{formatMs(log.latencyMs)}</td>
      <td className="px-4 py-3 text-center">
        {log.retryCount > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
            <RotateCw className="h-3 w-3" />
            {log.retryCount}
          </span>
        ) : (
          <span className="font-mono text-xs text-slate-600">0</span>
        )}
      </td>
      <td className="px-4 py-3">
        {log.signature ? (
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400" title={log.signature}>
            <TimerReset className="hidden h-3 w-3 text-violet-400 xl:inline" />
            {log.signature.slice(0, 22)}…
          </span>
        ) : (
          <span className="text-[11px] italic text-slate-600">unsigned</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <ChevronRight className="ml-auto h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-violet-400" />
      </td>
    </tr>
  );
}
