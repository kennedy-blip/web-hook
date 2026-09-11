import { useEffect, useMemo, useState } from "react";
import { ArrowDown, CircleCheck, CircleX, Clock, Gauge, Hourglass, Play, Send, Shuffle, Sigma, TriangleAlert } from "lucide-react";
import { useStore } from "@/store";
import { Button, Card, Field, inputCls, monoInputCls, StatCard, StatusBadge, Toggle, Segmented, toneStyles } from "@/components/ui";
import {
  backoffDelay,
  backoffSchedule,
  formatMs,
  isRetryable,
  rawBackoff,
  reasonPhrase,
  SCENARIOS,
  simulateReceiver,
  statusTone,
} from "@/lib/webhook";
import type { ReceiverScenario, RetryPolicy } from "@/types";
import { cn } from "@/utils/cn";

interface SimEvent {
  attempt: number;
  waitMs: number;
  startMs: number;
  endMs: number;
  status: number;
  statusText: string;
  latencyMs: number;
  error?: string;
  outcome: "delivered" | "retry" | "gave-up" | "rejected";
}

/** Virtual-time simulation: no real waiting, the timeline is replayed in the UI. */
function simulateRun(policy: RetryPolicy, scenario: ReceiverScenario, recoverAfter: number): SimEvent[] {
  const events: SimEvent[] = [];
  const maxAttempts = policy.enabled ? policy.maxRetries + 1 : 1;
  let clock = 0;
  for (let n = 1; n <= maxAttempts; n++) {
    const wait = n > 1 ? backoffDelay(n - 1, policy) : 0;
    clock += wait;
    const response = simulateReceiver(scenario, n, recoverAfter);
    const start = clock;
    clock += response.latencyMs;
    const tone = statusTone(response.status);
    const exhausted = n === maxAttempts;
    let outcome: SimEvent["outcome"];
    if (tone === "success") outcome = "delivered";
    else if (!isRetryable(response.status)) outcome = "rejected";
    else if (exhausted) outcome = "gave-up";
    else outcome = "retry";
    events.push({
      attempt: n,
      waitMs: wait,
      startMs: start,
      endMs: clock,
      status: response.status,
      statusText: response.statusText || reasonPhrase(response.status),
      latencyMs: response.latencyMs,
      error: response.error,
      outcome,
    });
    if (outcome !== "retry") break;
  }
  return events;
}

export function RetrySimulator() {
  const { state, updateConfig, dispatchWebhook, dispatching, setTab } = useStore();
  const policy = state.config.retry;
  const scenario = state.config.scenario;

  const [run, setRun] = useState<SimEvent[] | null>(null);
  const [visible, setVisible] = useState(0);
  const [jitterPreview, setJitterPreview] = useState(0);

  const setPolicy = (patch: Partial<RetryPolicy>) => updateConfig({ retry: { ...policy, ...patch } });

  const schedule = useMemo(() => backoffSchedule(policy), [policy]);
  const maxDelay = Math.max(1, ...schedule);
  const worstCaseWait = schedule.reduce((s, d) => s + d, 0);
  const totalAttempts = policy.enabled ? policy.maxRetries + 1 : 1;

  // Stepper that reveals the simulated timeline one attempt at a time.
  useEffect(() => {
    if (!run || visible >= run.length) return;
    const t = setTimeout(() => setVisible((v) => v + 1), 700);
    return () => clearTimeout(t);
  }, [run, visible]);

  const start = () => {
    setRun(simulateRun(policy, scenario, state.config.flakyRecoverAfter));
    setVisible(0);
  };

  const finalEvent = run && run.length ? run[run.length - 1] : null;
  const runFinished = !!run && visible >= run.length;
  const delivered = runFinished && finalEvent?.outcome === "delivered";
  const runTotal = run ? run[run.length - 1]?.endMs ?? 0 : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Retry Simulator</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Model exponential backoff before sending. Tune the policy, choose how the receiver misbehaves, and replay the attempt timeline to see when a delivery recovers or lands in the dead-letter queue.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Max attempts" value={totalAttempts} icon={Send} accent="violet" hint={`1 initial + ${policy.enabled ? policy.maxRetries : 0} retries`} />
        <StatCard label="Worst-case wait" value={formatMs(worstCaseWait)} icon={Hourglass} accent="amber" hint="Sum of backoff delays" />
        <StatCard label="Final backoff" value={schedule.length ? formatMs(schedule[schedule.length - 1]) : "—"} icon={Gauge} accent="rose" hint={`Capped at ${formatMs(policy.maxDelayMs)}`} />
        <StatCard label="Multiplier" value={`×${policy.multiplier}`} icon={Sigma} accent="emerald" hint={policy.jitter ? "Equal jitter enabled" : "Deterministic schedule"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Policy */}
        <Card title="Backoff Policy" subtitle="Exponential retry configuration" icon={Gauge} accent="violet" className="xl:col-span-2 self-start">
          <div className="space-y-5">
            <Toggle
              checked={policy.enabled}
              onChange={(enabled) => setPolicy({ enabled })}
              label="Retries enabled"
              description="Applies to dispatches made from the Payload Dispatcher too."
            />

            <div className={cn("space-y-5 transition", !policy.enabled && "pointer-events-none opacity-40")}>
              <Field label={`Max retries · ${policy.maxRetries}`}>
                <input
                  type="range"
                  min={0}
                  max={10}
                  aria-label="Max retries"
                  value={policy.maxRetries}
                  onChange={(e) => setPolicy({ maxRetries: Number(e.target.value) })}
                  className="w-full accent-violet-600"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Base delay (ms)">
                  <input
                    type="number"
                    min={10}
                    step={50}
                    aria-label="Base delay"
                    value={policy.baseDelayMs}
                    onChange={(e) => setPolicy({ baseDelayMs: Math.max(10, Number(e.target.value) || 10) })}
                    className={monoInputCls}
                  />
                </Field>
                <Field label="Max delay (ms)">
                  <input
                    type="number"
                    min={10}
                    step={100}
                    aria-label="Max delay"
                    value={policy.maxDelayMs}
                    onChange={(e) => setPolicy({ maxDelayMs: Math.max(10, Number(e.target.value) || 10) })}
                    className={monoInputCls}
                  />
                </Field>
              </div>

              <Field label="Multiplier">
                <Segmented
                  options={[1.5, 2, 2.5, 3].map((m) => ({ value: String(m), label: `×${m}` }))}
                  value={String(policy.multiplier)}
                  onChange={(v) => setPolicy({ multiplier: Number(v) })}
                />
              </Field>

              <Toggle
                checked={policy.jitter}
                onChange={(jitter) => setPolicy({ jitter })}
                label="Equal jitter"
                description="Randomises each delay between 50% and 100% of its base value to avoid thundering herds."
              />

              <div className="space-y-3 border-t border-white/[0.06] pt-5">
                <Field label="Simulated receiver">
                  <select
                    aria-label="Simulated receiver behavior"
                    value={scenario}
                    onChange={(e) => updateConfig({ scenario: e.target.value as ReceiverScenario })}
                    className={cn(inputCls, "cursor-pointer")}
                  >
                    {SCENARIOS.map((s) => (
                      <option key={s.id} value={s.id} className="bg-panel">
                        {s.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {scenario === "flaky" && (
                  <Field label="Recover after N failed attempts">
                    <input
                      type="number"
                      min={0}
                      max={10}
                      aria-label="Recover after"
                      value={state.config.flakyRecoverAfter}
                      onChange={(e) => updateConfig({ flakyRecoverAfter: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
                      className={cn(monoInputCls, "max-w-[160px]")}
                    />
                  </Field>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-6 xl:col-span-3">
          {/* Schedule */}
          <Card
            title="Backoff Schedule"
            subtitle="delay = min(maxDelay, base × multiplier^(retry − 1))"
            icon={Clock}
            accent="amber"
            actions={
              <Button size="sm" variant="ghost" icon={Shuffle} onClick={() => setJitterPreview((n) => n + 1)} disabled={!policy.enabled || policy.maxRetries === 0}>
                Preview jitter
              </Button>
            }
          >
            {!policy.enabled || policy.maxRetries === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                {policy.enabled ? "Set max retries above 0 to see the schedule." : "Retries are disabled — each delivery gets exactly one attempt."}
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex h-44 items-end gap-3 rounded-xl border border-white/[0.05] bg-canvas/50 px-4 pb-3 pt-6">
                  <div className="flex w-10 shrink-0 flex-col items-center justify-end pb-6 text-[10px] font-mono text-slate-500">
                    <span className="mb-auto">#1</span>
                    <span>initial</span>
                  </div>
                  {schedule.map((delay, i) => {
                    const h = Math.max(8, (rawBackoff(i + 1, policy) / maxDelay) * 100);
                    const jittered = policy.jitter ? backoffDelay(i + 1, policy, () => ((jitterPreview * 37 + i * 91) % 100) / 100) : delay;
                    return (
                      <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                        <span className="font-mono text-[11px] text-amber-300 opacity-0 transition group-hover:opacity-100">{formatMs(jittered)}</span>
                        <div className="relative w-full overflow-hidden rounded-t-md" style={{ height: `${h}%` }}>
                          <div
                            className="absolute inset-0 rounded-t-md bg-gradient-to-t from-amber-600/70 to-amber-300/90 shadow-[0_0_18px_rgba(245,158,11,0.25)] transition group-hover:from-amber-500 group-hover:to-amber-200"
                          />
                          {policy.jitter && (
                            <div className="absolute inset-x-0 bottom-0 rounded-t-md border-t-2 border-dashed border-white/50 bg-white/5" style={{ height: `${(jittered / Math.max(1, rawBackoff(i + 1, policy))) * 100}%` }} />
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">R{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
                  {schedule.map((d, i) => (
                    <span key={i}>
                      R{i + 1}: <span className="text-slate-300">{formatMs(d)}</span>
                    </span>
                  ))}
                  {policy.jitter && <span className="text-slate-600">· dashed line = jittered sample</span>}
                </div>
              </div>
            )}
          </Card>

          {/* Simulation */}
          <Card
            title="Attempt Timeline Replay"
            subtitle={`Receiver: ${SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario}`}
            icon={Play}
            accent="emerald"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="primary" icon={Play} onClick={start} disabled={!!run && !runFinished}>
                  {run ? "Run again" : "Run simulation"}
                </Button>
                <Button size="sm" variant="secondary" icon={Send} loading={dispatching} onClick={() => dispatchWebhook().then(() => setTab("logs"))}>
                  Send live
                </Button>
              </div>
            }
          >
            {!run ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-slate-400">Run the simulation to replay each attempt in virtual time.</p>
                <p className="max-w-sm text-xs text-slate-500">
                  The simulator uses your current policy and receiver behavior. “Send live” dispatches the same configuration for real and records it in Delivery Logs.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <ol className="space-y-0">
                  {run.map((ev, i) => {
                    if (i >= visible) return null;
                    const tone = toneStyles[statusTone(ev.status)];
                    const isLast = i === run.length - 1;
                    return (
                      <li key={ev.attempt} className="animate-fade-in">
                        {ev.waitMs > 0 && (
                          <div className="flex items-center gap-3 py-1.5 pl-[13px] font-mono text-[11px] text-amber-400/90">
                            <ArrowDown className="h-3.5 w-3.5" />
                            backoff {formatMs(ev.waitMs)}
                          </div>
                        )}
                        <div className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className={cn("grid h-7 w-7 place-items-center rounded-full border font-mono text-[11px] font-bold", tone.bg, tone.border, tone.text)}>
                              {ev.attempt}
                            </span>
                            {!isLast && <span className="my-1 w-px flex-1 bg-white/10" />}
                          </div>
                          <div className="min-w-0 flex-1 rounded-xl border border-white/[0.06] bg-canvas/50 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge status={ev.status} statusText={ev.statusText} />
                              <span className="font-mono text-[11px] text-slate-400">{formatMs(ev.latencyMs)}</span>
                              <span className="ml-auto font-mono text-[10px] text-slate-500">t+{formatMs(ev.startMs)}</span>
                            </div>
                            {ev.error && <p className="mt-2 font-mono text-[11px] text-rose-400">{ev.error}</p>}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                  {!runFinished && (
                    <li className="flex items-center gap-3 pl-0.5 pt-1 text-xs text-slate-500">
                      <span className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-white/20">
                        <span className="h-2 w-2 animate-ping rounded-full bg-violet-400" />
                      </span>
                      awaiting attempt {visible + 1}…
                    </li>
                  )}
                </ol>

                {runFinished && finalEvent && (
                  <div
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm",
                      delivered ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200",
                    )}
                  >
                    {delivered ? <CircleCheck className="h-5 w-5 text-emerald-400" /> : <CircleX className="h-5 w-5 text-rose-400" />}
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {delivered
                          ? `Recovered on attempt ${finalEvent.attempt} of ${totalAttempts}`
                          : finalEvent.outcome === "rejected"
                            ? "Permanent failure — not retried"
                            : "Retries exhausted — moved to dead-letter queue"}
                      </p>
                      <p className="font-mono text-[11px] opacity-80">
                        {run.length} attempt{run.length === 1 ? "" : "s"} · virtual elapsed {formatMs(runTotal)}
                      </p>
                    </div>
                    {!delivered && finalEvent.outcome === "gave-up" && <TriangleAlert className="h-5 w-5 text-rose-400" />}
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
      <p className="text-xs text-slate-600">Retryable: 408, 425, 429, 500, 502, 503, 504 and network errors. Other 4xx responses are treated as permanent.</p>
    </div>
  );
}
