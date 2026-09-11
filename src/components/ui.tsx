import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { reasonPhrase, statusTone, type Tone } from "@/lib/webhook";

export const toneStyles: Record<Tone | "violet" | "neutral", { text: string; bg: string; border: string; dot: string }> = {
  success: { text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-400" },
  retry: { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/30", dot: "bg-amber-400" },
  failure: { text: "text-rose-300", bg: "bg-rose-500/10", border: "border-rose-500/30", dot: "bg-rose-400" },
  violet: { text: "text-violet-300", bg: "bg-violet-500/10", border: "border-violet-500/30", dot: "bg-violet-400" },
  neutral: { text: "text-slate-300", bg: "bg-white/[0.04]", border: "border-white/10", dot: "bg-slate-400" },
};

export const inputCls =
  "w-full rounded-lg border border-white/10 bg-canvas/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20";
export const monoInputCls = cn(inputCls, "font-mono text-[13px]");

export function StatusBadge({ status, statusText, className }: { status: number; statusText?: string; className?: string }) {
  const style = toneStyles[statusTone(status)];
  const label = statusText || reasonPhrase(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold",
        style.bg,
        style.border,
        style.text,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {status === 0 ? "ERR" : status}
      <span className="font-sans font-medium opacity-90">{label}</span>
    </span>
  );
}

const accentClasses = {
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  slate: "border-white/10 bg-white/[0.04] text-slate-300",
};

export function Card({
  title,
  subtitle,
  icon: Icon,
  accent = "violet",
  actions,
  children,
  className,
  flush,
  id,
}: {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: keyof typeof accentClasses;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-2xl border border-white/[0.07] bg-panel shadow-xl shadow-black/30 ring-1 ring-inset ring-white/[0.02]",
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", accentClasses[accent])}>
                <Icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && "p-5")}>{children}</div>
    </section>
  );
}

const buttonVariants = {
  primary:
    "bg-violet-600 text-white shadow-lg shadow-violet-600/25 hover:bg-violet-500 border border-violet-400/30",
  secondary: "bg-white/[0.04] text-slate-200 border border-white/10 hover:bg-white/[0.08] hover:border-white/20",
  success: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25",
  danger: "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25",
  amber: "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25",
  ghost: "text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] border border-transparent",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  size?: "sm" | "md";
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
        buttonVariants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {description && <p className="text-xs text-slate-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-violet-600" : "bg-slate-700",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable — ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-white",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex flex-wrap rounded-lg border border-white/10 bg-canvas/60 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
              active ? "bg-violet-600 text-white shadow shadow-violet-600/30" : "text-slate-400 hover:text-slate-200",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "violet",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: LucideIcon;
  accent?: keyof typeof accentClasses;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-panel p-4 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg border", accentClasses[accent])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold text-white">{value}</div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-400">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        <p className="mt-1 max-w-sm text-xs text-slate-500">{text}</p>
      </div>
      {action}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function prettyBody(text: string): string {
  if (!text) return "(empty body)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
