import { CircleAlert, CircleCheck, Info, X, Webhook } from "lucide-react";
import { StoreProvider, useStore, type Toast } from "@/store";
import { Header } from "@/components/Header";
import { WebhookDispatcher } from "@/components/WebhookDispatcher";
import { DeliveryLogs } from "@/components/DeliveryLogs";
import { SignatureVerifier } from "@/components/SignatureVerifier";
import { RetrySimulator } from "@/components/RetrySimulator";
import { cn } from "@/utils/cn";

function Workspace() {
  const { tab } = useStore();
  return (
    <div className="min-h-screen text-slate-200">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div key={tab} className="animate-fade-in">
          {tab === "dispatcher" && <WebhookDispatcher />}
          {tab === "logs" && <DeliveryLogs />}
          {tab === "verifier" && <SignatureVerifier />}
          {tab === "retry" && <RetrySimulator />}
        </div>
      </main>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] px-4 py-6 text-xs text-slate-600 sm:px-6">
        <span className="flex items-center gap-2">
          <Webhook className="h-3.5 w-3.5 text-violet-500/70" />
          WebhookPulse · delivery tester, signature verifier &amp; retry simulator
        </span>
        <span className="font-mono">Secrets and history persist in local browser storage only.</span>
      </footer>
      <Toasts />
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = toast.tone === "success" ? CircleCheck : toast.tone === "failure" ? CircleAlert : Info;
  return (
    <div
      className={cn(
        "animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-panel/95 px-4 py-3 text-sm shadow-2xl shadow-black/50 backdrop-blur",
        toast.tone === "success" && "border-emerald-500/30",
        toast.tone === "failure" && "border-rose-500/30",
        toast.tone === "info" && "border-violet-500/30",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          toast.tone === "success" && "text-emerald-400",
          toast.tone === "failure" && "text-rose-400",
          toast.tone === "info" && "text-violet-400",
        )}
      />
      <p className="min-w-0 flex-1 break-words font-mono text-xs text-slate-200">{toast.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification" className="text-slate-500 hover:text-slate-200">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
