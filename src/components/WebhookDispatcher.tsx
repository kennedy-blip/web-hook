import { useMemo, type KeyboardEvent } from "react";
import {
  ArrowRight,
  Braces,
  Copy,
  Globe,
  KeyRound,
  ListChecks,
  Plus,
  RotateCcw,
  Send,
  Server,
  Sparkles,
  Terminal,
  Trash2,
  Wifi,
  Zap,
} from "lucide-react";
import { useStore } from "@/store";
import {
  Button,
  Card,
  CopyButton,
  Field,
  formatDateTime,
  inputCls,
  monoInputCls,
  prettyBody,
  Segmented,
  StatusBadge,
  timeAgo,
  Toggle,
  toneStyles,
} from "@/components/ui";
import {
  backoffSchedule,
  buildTemplatePayload,
  detectEvent,
  formatMs,
  isValidUrl,
  METHODS,
  SCENARIOS,
  TEMPLATES,
  validateJson,
} from "@/lib/webhook";
import { buildCurl, buildHeaders, computeSignature } from "@/lib/delivery";
import { newId } from "@/lib/crypto";
import type { DispatchConfig, HeaderEntry, HttpMethod } from "@/types";
import { cn } from "@/utils/cn";

export function WebhookDispatcher() {
  const { state, updateConfig, dispatchWebhook, dispatching, progress, lastLog, setTab, activeSecret } = useStore();
  const { config } = state;
  const urlOk = isValidUrl(config.url);
  const json = useMemo(() => validateJson(config.payload), [config.payload]);
  const schedule = useMemo(() => backoffSchedule(config.retry), [config.retry]);
  const signature = useMemo(
    () => (config.signed ? computeSignature(config.payload, activeSecret) : null),
    [config.signed, config.payload, activeSecret],
  );

  const setHeaders = (headers: HeaderEntry[]) => updateConfig({ headers });
  const updateHeader = (id: string, patch: Partial<HeaderEntry>) =>
    setHeaders(config.headers.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const removeHeader = (id: string) => setHeaders(config.headers.filter((h) => h.id !== id));
  const addHeader = () =>
    setHeaders([...config.headers, { id: newId("hdr"), key: "", value: "", enabled: true }]);

  const setRetry = (patch: Partial<DispatchConfig["retry"]>) => updateConfig({ retry: { ...config.retry, ...patch } });

  const onTabKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: s, selectionEnd: end, value } = el;
    updateConfig({ payload: value.slice(0, s) + "  " + value.slice(end) });
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = s + 2;
    });
  };

  const systemHeaders = buildHeaders(config, {
    deliveryId: "<delivery-id>",
    timestamp: "<unix-ts>",
    event: detectEvent(config.payload),
    signature,
    attempt: 1,
  });
  const systemKeys = Object.keys(systemHeaders).filter((k) => !config.headers.some((h) => h.enabled && h.key.trim() === k));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Payload Dispatcher</h2>
        <p className="mt-1 text-sm text-slate-400">
          Configure a target endpoint, shape headers and payload, then fire a signed webhook through the simulated receiver or a live request.
        </p>
      </div>

      {/* Target configurator */}
      <Card
        title="Target Configurator"
        subtitle="Endpoint, method, delivery mode and retry policy"
        icon={Globe}
        accent="violet"
        actions={
          <Button variant="primary" icon={Send} loading={dispatching} disabled={!urlOk} onClick={() => dispatchWebhook()}>
            {dispatching ? "Dispatching…" : "Dispatch Webhook"}
          </Button>
        }
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start">
            <Segmented
              options={METHODS.map((m) => ({ value: m, label: m }))}
              value={config.method}
              onChange={(m: HttpMethod) => updateConfig({ method: m })}
            />
            <div className="min-w-0 flex-1">
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  aria-label="Target endpoint URL"
                  value={config.url}
                  onChange={(e) => updateConfig({ url: e.target.value })}
                  placeholder="https://api.mycompany.com/v1/webhooks"
                  spellCheck={false}
                  className={cn(monoInputCls, "pl-9", !urlOk && config.url && "border-rose-500/50 focus:border-rose-500/60 focus:ring-rose-500/20")}
                />
              </div>
              {!urlOk && config.url && (
                <p className="mt-1.5 text-xs text-rose-400">Enter a valid http:// or https:// endpoint URL.</p>
              )}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Delivery mode" hint={config.mode === "simulated" ? "Routes to an in-browser mock receiver. No network traffic." : "Sends a real fetch() from your browser. The target must allow CORS."}>
              <Segmented
                options={[
                  { value: "simulated", label: "Simulated receiver", icon: Server },
                  { value: "live", label: "Live fetch", icon: Wifi },
                ]}
                value={config.mode}
                onChange={(mode) => updateConfig({ mode })}
              />
            </Field>

            {config.mode === "simulated" ? (
              <Field label="Receiver behavior" hint={SCENARIOS.find((s) => s.id === config.scenario)?.description}>
                <select
                  aria-label="Receiver behavior"
                  value={config.scenario}
                  onChange={(e) => updateConfig({ scenario: e.target.value as DispatchConfig["scenario"] })}
                  className={cn(inputCls, "cursor-pointer")}
                >
                  {SCENARIOS.map((s) => (
                    <option key={s.id} value={s.id} className="bg-panel">
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Live transport" hint="Requests time out after 10 seconds. Blocked CORS requests surface as Network Error.">
                <div className="flex h-[38px] items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 text-xs text-amber-200">
                  <Zap className="h-3.5 w-3.5" /> Real network call to {config.method} endpoint
                </div>
              </Field>
            )}
          </div>

          {config.mode === "simulated" && config.scenario === "flaky" && (
            <Field label="Recover after N failed attempts" hint="The receiver returns 504 for N attempts, then 200 OK.">
              <input
                type="number"
                min={0}
                max={10}
                value={config.flakyRecoverAfter}
                onChange={(e) => updateConfig({ flakyRecoverAfter: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                className={cn(monoInputCls, "max-w-[160px]")}
              />
            </Field>
          )}

          <div className="rounded-xl border border-white/[0.06] bg-canvas/40 p-4">
            <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
              <Toggle
                checked={config.retry.enabled}
                onChange={(enabled) => setRetry({ enabled })}
                label="Auto-retry with exponential backoff"
                description={
                  config.retry.enabled
                    ? `Retries on 408/425/429/500/502/503/504 & network errors · schedule: ${schedule.length ? schedule.map((d) => formatMs(d)).join(" → ") : "none"}`
                    : "Failed deliveries are recorded after a single attempt."
                }
              />
              <div className={cn("flex items-center gap-3", !config.retry.enabled && "opacity-40")}>
                <span className="text-xs font-medium text-slate-400">Max retries</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  disabled={!config.retry.enabled}
                  aria-label="Max retries"
                  value={config.retry.maxRetries}
                  onChange={(e) => setRetry({ maxRetries: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                  className={cn(monoInputCls, "w-20 text-center")}
                />
              </div>
            </div>
          </div>

          {dispatching && progress && (
            <div className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 font-mono text-xs text-amber-200">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </span>
              {progress.phase === "waiting"
                ? `Attempt ${progress.attempt}/${progress.maxAttempts} scheduled in ${formatMs(progress.delayMs ?? 0)} (exponential backoff)…`
                : `Sending attempt ${progress.attempt}/${progress.maxAttempts}…`}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Headers */}
        <Card
          title="Custom Headers"
          subtitle="Toggle, edit or add request headers"
          icon={ListChecks}
          accent="violet"
          actions={
            <Button size="sm" variant="secondary" icon={Plus} onClick={addHeader}>
              Add header
            </Button>
          }
        >
          <div className="space-y-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <span className="sr-only">Enabled</span>
              <span>Key</span>
              <span>Value</span>
              <span className="sr-only">Remove</span>
            </div>
            {config.headers.map((h) => (
              <div key={h.id} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2">
                <input
                  type="checkbox"
                  aria-label={`Enable header ${h.key || "row"}`}
                  checked={h.enabled}
                  onChange={(e) => updateHeader(h.id, { enabled: e.target.checked })}
                  className="h-4 w-4 cursor-pointer accent-violet-600"
                />
                <input
                  aria-label="Header key"
                  value={h.key}
                  placeholder="Header-Name"
                  spellCheck={false}
                  onChange={(e) => updateHeader(h.id, { key: e.target.value })}
                  className={cn(monoInputCls, "py-1.5 text-xs", !h.enabled && "opacity-40")}
                />
                <input
                  aria-label="Header value"
                  value={h.value}
                  placeholder="value"
                  spellCheck={false}
                  onChange={(e) => updateHeader(h.id, { value: e.target.value })}
                  className={cn(monoInputCls, "py-1.5 text-xs", !h.enabled && "opacity-40")}
                />
                <button
                  type="button"
                  aria-label="Remove header"
                  onClick={() => removeHeader(h.id)}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {config.headers.length === 0 && <p className="px-1 py-4 text-center text-xs text-slate-500">No custom headers yet.</p>}
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Injected by WebhookPulse</p>
            <div className="flex flex-wrap gap-1.5">
              {systemKeys.map((k) => (
                <span
                  key={k}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                    k === "X-Hub-Signature-256" ? "border-violet-500/30 bg-violet-500/10 text-violet-300" : "border-white/10 bg-white/[0.03] text-slate-400",
                  )}
                >
                  {k}
                </span>
              ))}
            </div>
          </div>
        </Card>

        {/* Signing */}
        <Card
          title="HMAC-SHA256 Signing"
          subtitle="Signs the raw payload with the selected secret"
          icon={KeyRound}
          accent="violet"
          actions={
            <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => setTab("verifier")}>
              Manage secrets
            </Button>
          }
        >
          <div className="space-y-5">
            <Toggle
              checked={config.signed}
              onChange={(signed) => updateConfig({ signed })}
              label="Sign outgoing payload"
              description="Adds an X-Hub-Signature-256 header computed over the exact request body."
            />
            <Field label="Signing secret">
              <select
                aria-label="Signing secret"
                value={config.secretId}
                disabled={!config.signed}
                onChange={(e) => updateConfig({ secretId: e.target.value })}
                className={cn(inputCls, "cursor-pointer disabled:opacity-40")}
              >
                {state.secrets.map((s) => (
                  <option key={s.id} value={s.id} className="bg-panel">
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className={cn("space-y-2 transition", !config.signed && "opacity-40")}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">X-Hub-Signature-256</span>
                {signature && <CopyButton text={signature} />}
              </div>
              <div className="break-all rounded-lg border border-violet-500/20 bg-canvas/70 p-3 font-mono text-[12px] leading-relaxed text-violet-300">
                {signature ?? "unsigned — enable signing to generate a digest"}
              </div>
              <p className="text-xs text-slate-500">
                Digest = HMAC-SHA256(secret, raw body UTF-8), hex-encoded, prefixed with <code className="font-mono text-slate-400">sha256=</code>.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Payload editor */}
      <Card
        title="Payload Editor"
        subtitle="Monospace JSON body with preset event templates"
        icon={Braces}
        accent="violet"
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]",
              json.ok ? toneStyles.success.border + " " + toneStyles.success.bg + " text-emerald-300" : toneStyles.failure.border + " " + toneStyles.failure.bg + " text-rose-300",
            )}
          >
            {json.ok ? "valid JSON" : "invalid JSON"}
          </span>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {TEMPLATES.map((t) => {
              const active = config.templateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={t.description}
                  onClick={() => updateConfig({ templateId: t.id, payload: buildTemplatePayload(t.id) })}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs transition",
                    active
                      ? "border-violet-500/50 bg-violet-500/15 text-violet-200"
                      : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-slate-200",
                  )}
                >
                  <Sparkles className={cn("h-3.5 w-3.5", active ? "text-violet-400" : "text-slate-600 group-hover:text-slate-400")} />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-canvas">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
                <span className="h-2 w-2 rounded-full bg-rose-500/70" />
                <span className="h-2 w-2 rounded-full bg-amber-500/70" />
                <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
                <span className="ml-2">payload.json · {new TextEncoder().encode(config.payload).length} bytes</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Braces}
                  disabled={!json.ok}
                  onClick={() => json.ok && updateConfig({ payload: JSON.stringify(json.value, null, 2) })}
                >
                  Format
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={() => updateConfig({ payload: buildTemplatePayload(config.templateId) })}
                >
                  Regenerate
                </Button>
                <CopyButton text={config.payload} label="Copy" />
              </div>
            </div>
            <textarea
              aria-label="JSON payload"
              value={config.payload}
              onChange={(e) => updateConfig({ payload: e.target.value })}
              onKeyDown={onTabKey}
              spellCheck={false}
              rows={14}
              className="block w-full resize-y bg-transparent p-4 font-mono text-[13px] leading-relaxed text-emerald-100/90 outline-none placeholder:text-slate-600"
            />
            {!json.ok && (
              <p className="border-t border-rose-500/20 bg-rose-500/5 px-4 py-2 font-mono text-xs text-rose-300">
                JSON parse error: {json.error}
              </p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Request Preview"
          subtitle="Equivalent cURL command for this configuration"
          icon={Terminal}
          accent="slate"
          actions={<CopyButton text={buildCurl(config, activeSecret)} label="Copy cURL" />}
        >
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/[0.06] bg-canvas p-4 font-mono text-[12px] leading-relaxed text-slate-300">
            {buildCurl(config, activeSecret)}
          </pre>
        </Card>

        <Card
          title="Last Response"
          subtitle={lastLog ? `${formatDateTime(lastLog.timestamp)} · ${timeAgo(lastLog.timestamp)}` : "Response inspector"}
          icon={Server}
          accent={lastLog ? (lastLog.outcome === "delivered" ? "emerald" : "rose") : "slate"}
          actions={
            lastLog ? (
              <Button size="sm" variant="secondary" icon={ListChecks} onClick={() => setTab("logs")}>
                Open in logs
              </Button>
            ) : undefined
          }
        >
          {!lastLog ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-slate-400">No dispatches yet this session.</p>
              <p className="max-w-xs text-xs text-slate-500">Dispatch the payload above to inspect status, latency, retries and the response body here.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={lastLog.finalStatus} statusText={lastLog.finalStatusText} />
                <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300">{formatMs(lastLog.latencyMs)}</span>
                <span
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                    lastLog.retryCount ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-white/10 text-slate-400",
                  )}
                >
                  {lastLog.retryCount} {lastLog.retryCount === 1 ? "retry" : "retries"}
                </span>
                <span className="rounded-md border border-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-400">{lastLog.mode}</span>
              </div>
              {lastLog.error && <p className="rounded-lg border border-rose-500/25 bg-rose-500/5 px-3 py-2 font-mono text-xs text-rose-300">{lastLog.error}</p>}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Response body</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/[0.06] bg-canvas p-3 font-mono text-[12px] text-slate-300">
                  {prettyBody(lastLog.responseBody)}
                </pre>
              </div>
            </div>
          )}
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-slate-500">
        <Copy className="h-3 w-3" />
        Tip: press <kbd className="rounded border border-white/10 px-1 font-mono text-[10px]">Tab</kbd> inside the payload editor to indent.
      </p>
    </div>
  );
}
