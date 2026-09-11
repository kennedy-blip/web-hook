import { useEffect, useMemo } from "react";
import { ArrowUpRight, Clock, Copy, KeyRound, RotateCw, Trash2, X, Zap, Play, FileJson, Server, ListOrdered, Hourglass, ShieldCheck } from "lucide-react";
import { useStore } from "@/store";
import { Button, CopyButton, formatDateTime, prettyBody, StatusBadge, timeAgo, toneStyles } from "@/components/ui";
import { formatMs, statusTone } from "@/lib/webhook";
import { hmacSha256Hex } from "@/lib/crypto";
import type { DeliveryLog } from "@/types";
import { cn } from "@/utils/cn";

function Section({ title, icon: Icon, action, children }: { title: string; icon: typeof Clock; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          <Icon className="h-3.5 w-3.5 text-violet-400" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function LogDrawer({ log, onClose }: { log: DeliveryLog; onClose: () => void }) {
  const { deleteLog, dispatchWebhook, dispatching, openVerifier, state } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const delivered = log.outcome === "delivered";
  const headerEntries = Object.entries(log.requestHeaders);
  const responseEntries = Object.entries(log.responseHeaders);
  const payloadBytes = useMemo(() => new TextEncoder().encode(log.payload).length, [log.payload]);
  const recomputed = log.signature && log.secretName ? log.signature : null;
  const secretStillExists = state.secrets.some((s) => s.id === log.config.secretId);
  const outcomeTone = delivered ? toneStyles.success : toneStyles.failure;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="log-drawer-title">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <aside className="animate-drawer-in absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#0b1120] shadow-2xl shadow-black/60">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold", outcomeTone.bg, outcomeTone.border, outcomeTone.text)}>
                {delivered ? "DELIVERED" : "FAILED"}
              </span>
              <StatusBadge status={log.finalStatus} statusText={log.finalStatusText} />
            </div>
            <h2 id="log-drawer-title" className="truncate font-mono text-base font-semibold text-white">
              {log.event}
            </h2>
            <p className="font-mono text-[11px] text-slate-500">
              {log.id} · {formatDateTime(log.timestamp)} · {timeAgo(log.timestamp)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-6">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Latency", value: formatMs(log.latencyMs), icon: Zap },
              { label: "Total time", value: formatMs(log.totalDurationMs), icon: Hourglass },
              { label: "Retries", value: String(log.retryCount), icon: RotateCw },
              { label: "Mode", value: log.mode, icon: Server },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-white/[0.06] bg-canvas/60 p-3">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <item.icon className="h-3 w-3" />
                  {item.label}
                </p>
                <p className="mt-1 font-mono text-sm text-slate-100">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-canvas/60 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Endpoint</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 break-all font-mono text-sm text-slate-200">
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] font-bold text-violet-300">{log.method}</span>
              {log.url}
            </p>
          </div>

          {/* Attempt timeline */}
          <Section title="Attempt timeline" icon={ListOrdered}>
            <ol className="relative space-y-3 border-l border-white/10 pl-5">
              {log.attempts.map((a) => {
                const tone = toneStyles[statusTone(a.status)];
                return (
                  <li key={a.attempt} className="relative">
                    <span className={cn("absolute -left-[27px] top-2 h-3 w-3 rounded-full border-2 border-[#0b1120]", tone.dot)} />
                    {a.backoffMs > 0 && (
                      <p className="mb-1 font-mono text-[11px] text-amber-400/80">↳ exponential backoff · waited {formatMs(a.backoffMs)}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-canvas/50 px-3 py-2">
                      <span className="font-mono text-[11px] text-slate-500">#{a.attempt}</span>
                      <StatusBadge status={a.status} statusText={a.statusText} />
                      <span className="font-mono text-[11px] text-slate-400">{formatMs(a.latencyMs)}</span>
                      <span className="ml-auto font-mono text-[11px] text-slate-500">{a.retryable ? "retryable" : "permanent"}</span>
                    </div>
                    {a.error && <p className="mt-1 font-mono text-[11px] text-rose-400">{a.error}</p>}
                  </li>
                );
              })}
            </ol>
          </Section>

          {/* Signature */}
          <Section
            title="HMAC-SHA256 signature"
            icon={KeyRound}
            action={
              log.signature ? (
                <Button size="sm" variant="ghost" icon={ShieldCheck} onClick={() => openVerifier({ payload: log.payload, signature: log.signature ?? undefined, secretId: log.config.secretId })}>
                  Verify
                </Button>
              ) : undefined
            }
          >
            {log.signature ? (
              <div className="space-y-2 rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-violet-300">X-Hub-Signature-256</span>
                  <CopyButton text={log.signature} />
                </div>
                <p className="break-all font-mono text-[12px] leading-relaxed text-violet-200">{log.signature}</p>
                <p className="text-[11px] text-slate-500">
                  Signed with <span className="text-slate-300">{log.secretName ?? "unknown secret"}</span>
                  {secretStillExists ? "" : " (secret since deleted)"} · {payloadBytes} bytes of raw body
                </p>
              </div>
            ) : (
              <p className="rounded-xl border border-white/[0.06] bg-canvas/50 p-4 text-sm text-slate-500">This delivery was sent without a signature.</p>
            )}
            {recomputed && (
              <p className="font-mono text-[10px] text-slate-600">digest check: sha256 over payload · {hmacSha256Hex(state.secrets.find((s) => s.id === log.config.secretId)?.value ?? "", log.payload) === recomputed.slice(7) ? "matches current secret" : "secret rotated since dispatch"}</p>
            )}
          </Section>

          {/* Request headers */}
          <Section title="Request headers" icon={Copy} action={<CopyButton text={headerEntries.map(([k, v]) => `${k}: ${v}`).join("\n")} label="Copy all" />}>
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              {headerEntries.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)] gap-3 border-t border-white/[0.04] px-3 py-2 first:border-t-0">
                  <span className={cn("break-all font-mono text-[12px]", k.startsWith("X-Hub") ? "text-violet-300" : "text-slate-400")}>{k}</span>
                  <span className="break-all font-mono text-[12px] text-slate-200">{v}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Payload */}
          <Section title="Raw payload" icon={FileJson} action={<CopyButton text={log.payload} label="Copy" />}>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/[0.06] bg-canvas p-4 font-mono text-[12px] leading-relaxed text-emerald-100/90">
              {log.payload}
            </pre>
          </Section>

          {/* Response */}
          <Section title="Response" icon={Server} action={<CopyButton text={log.responseBody} label="Copy body" />}>
            {log.error && <p className="mb-2 rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 font-mono text-xs text-rose-300">{log.error}</p>}
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/[0.06] bg-canvas p-4 font-mono text-[12px] leading-relaxed text-slate-300">
              {prettyBody(log.responseBody)}
            </pre>
            {responseEntries.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {responseEntries.map(([k, v]) => (
                  <span key={k} className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-slate-400">
                    {k}: <span className="text-slate-200">{v}</span>
                  </span>
                ))}
              </div>
            )}
          </Section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] bg-[#0b1120] px-5 py-4 sm:px-6">
          <Button
            variant="danger"
            size="sm"
            icon={Trash2}
            onClick={() => {
              deleteLog(log.id);
              onClose();
            }}
          >
            Delete entry
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={Play} loading={dispatching} onClick={() => dispatchWebhook(log.config)}>
              Replay delivery
            </Button>
            <Button variant="ghost" icon={ArrowUpRight} onClick={onClose}>
              Close
            </Button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
