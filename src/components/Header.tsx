import { useEffect, useState } from "react";
import { ListChecks, RotateCw, Send, ShieldCheck, Trash2, Webhook, Send as SendIcon, type LucideIcon } from "lucide-react";
import { useStore, type TabId } from "@/store";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "dispatcher", label: "Payload Dispatcher", icon: SendIcon },
  { id: "logs", label: "Delivery Logs", icon: ListChecks },
  { id: "verifier", label: "Signature Verifier", icon: ShieldCheck },
  { id: "retry", label: "Retry Simulator", icon: RotateCw },
];

export function Header() {
  const { tab, setTab, state, dispatchWebhook, dispatching, clearLogs } = useStore();
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const onClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearLogs();
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 pb-3 pt-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 animate-glow">
            <Webhook className="h-5 w-5 text-white" />
            <span className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-violet-300/40" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight tracking-tight text-white">
              Webhook<span className="text-violet-400">Pulse</span>
            </h1>
            <span className="mt-0.5 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Webhook Dispatcher: Active
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="primary" icon={Send} loading={dispatching} onClick={() => dispatchWebhook()}>
            <span className="hidden sm:inline">Send Test Webhook</span>
            <span className="sm:hidden">Test</span>
          </Button>
          <Button
            variant={confirmClear ? "danger" : "secondary"}
            icon={Trash2}
            onClick={onClear}
            disabled={state.logs.length === 0 && !confirmClear}
            title="Clear delivery history"
          >
            <span>{confirmClear ? "Confirm?" : "Clear History"}</span>
          </Button>
        </div>
      </div>

      <nav className="mx-auto max-w-7xl overflow-x-auto px-4 sm:px-6" aria-label="Primary">
        <div className="flex min-w-max gap-1">
          {TABS.map((t) => {
            const active = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-2 px-3 py-3 text-sm font-medium transition",
                  active ? "text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                <Icon className={cn("h-4 w-4", active && "text-violet-400")} />
                {t.label}
                {t.id === "logs" && (
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    {state.logs.length}
                  </span>
                )}
                <span
                  className={cn(
                    "absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-violet-500 transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
