import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import type { Attempt, DeliveryLog, DispatchConfig, HeaderEntry, Secret } from "@/types";
import { hmacSha256Hex, newId, randomHex, uuid } from "@/lib/crypto";
import { buildHeaders, runDelivery, type DeliveryProgress } from "@/lib/delivery";
import {
  buildTemplatePayload,
  detectEvent,
  formatMs,
  isRetryable,
  isValidUrl,
  reasonPhrase,
  statusTone,
} from "@/lib/webhook";

export type TabId = "dispatcher" | "logs" | "verifier" | "retry";
export type ToastTone = "success" | "failure" | "info";
export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}
export interface VerifierDraft {
  payload: string;
  signature?: string;
  secretId?: string;
}

const STORAGE_KEY = "webhookpulse.workspace.v1";
const MAX_LOGS = 150;

export function createSecret(name: string): Secret {
  return {
    id: newId("sec"),
    name,
    value: `whsec_${randomHex(24)}`,
    createdAt: new Date().toISOString(),
  };
}

export function defaultConfig(secretId: string): DispatchConfig {
  const headers: HeaderEntry[] = [
    { id: "hdr_ct", key: "Content-Type", value: "application/json", enabled: true },
    { id: "hdr_src", key: "X-Custom-Source", value: "WebhookPulse", enabled: true },
  ];
  return {
    url: "https://api.mycompany.com/v1/webhooks",
    method: "POST",
    headers,
    payload: buildTemplatePayload("customer.created"),
    templateId: "customer.created",
    mode: "simulated",
    scenario: "ok",
    flakyRecoverAfter: 2,
    signed: true,
    secretId,
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 500, multiplier: 2, maxDelayMs: 8000, jitter: false },
  };
}

export interface AppState {
  config: DispatchConfig;
  secrets: Secret[];
  logs: DeliveryLog[];
}

type Action =
  | { type: "config"; patch: Partial<DispatchConfig> }
  | { type: "addSecret"; secret: Secret }
  | { type: "updateSecret"; id: string; patch: Partial<Secret> }
  | { type: "deleteSecret"; id: string }
  | { type: "addLog"; log: DeliveryLog }
  | { type: "deleteLog"; id: string }
  | { type: "clearLogs" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "config":
      return { ...state, config: { ...state.config, ...action.patch } };
    case "addSecret":
      return { ...state, secrets: [...state.secrets, action.secret] };
    case "updateSecret":
      return {
        ...state,
        secrets: state.secrets.map((s) => (s.id === action.id ? { ...s, ...action.patch } : s)),
      };
    case "deleteSecret": {
      if (state.secrets.length <= 1) return state;
      const secrets = state.secrets.filter((s) => s.id !== action.id);
      const config =
        state.config.secretId === action.id ? { ...state.config, secretId: secrets[0].id } : state.config;
      return { ...state, secrets, config };
    }
    case "addLog":
      return { ...state, logs: [action.log, ...state.logs].slice(0, MAX_LOGS) };
    case "deleteLog":
      return { ...state, logs: state.logs.filter((l) => l.id !== action.id) };
    case "clearLogs":
      return { ...state, logs: [] };
    default:
      return state;
  }
}

type SeedAttempt = [status: number, latencyMs: number, backoffMs: number];
interface SeedSpec {
  template: string;
  minutesAgo: number;
  scenario: DeliveryLog["scenario"];
  attempts: SeedAttempt[];
}

const SEED_SPECS: SeedSpec[] = [
  { template: "customer.created", minutesAgo: 2, scenario: "ok", attempts: [[200, 184, 0]] },
  {
    template: "payment.failed",
    minutesAgo: 9,
    scenario: "flaky",
    attempts: [
      [504, 1932, 0],
      [504, 2214, 500],
      [200, 201, 1000],
    ],
  },
  { template: "order.shipped", minutesAgo: 17, scenario: "bad_request", attempts: [[400, 58, 0]] },
  {
    template: "subscription.renewed",
    minutesAgo: 41,
    scenario: "service_unavailable",
    attempts: [
      [503, 412, 0],
      [429, 66, 500],
      [500, 247, 1000],
      [503, 390, 2000],
    ],
  },
];

function seedBody(status: number): string {
  if (status === 200) return JSON.stringify({ status: "received", receipt: `rcpt_${randomHex(6)}` });
  if (status === 400) return JSON.stringify({ error: "validation_failed", message: "Field 'data.object.id' is required" });
  if (status === 504) return "<html><head><title>504 Gateway Time-out</title></head><body><h1>504 Gateway Time-out</h1></body></html>";
  return JSON.stringify({ error: "service_unavailable", retry_after: 2 });
}

function buildSeedLogs(config: DispatchConfig, secret: Secret): DeliveryLog[] {
  return SEED_SPECS.map((spec) => {
    const payload = buildTemplatePayload(spec.template);
    const event = detectEvent(payload);
    const start = Date.now() - spec.minutesAgo * 60_000;
    const signature = `sha256=${hmacSha256Hex(secret.value, payload)}`;
    const cfg: DispatchConfig = { ...config, payload, templateId: spec.template, scenario: spec.scenario };
    let cursor = start;
    const attempts: Attempt[] = spec.attempts.map(([status, latencyMs, backoffMs], i) => {
      cursor += backoffMs;
      const attempt: Attempt = {
        attempt: i + 1,
        status,
        statusText: reasonPhrase(status),
        latencyMs,
        backoffMs,
        retryable: isRetryable(status),
        timestamp: new Date(cursor).toISOString(),
      };
      cursor += latencyMs;
      return attempt;
    });
    const last = attempts[attempts.length - 1];
    const delivered = statusTone(last.status) === "success";
    const headers = buildHeaders(cfg, {
      deliveryId: uuid(),
      timestamp: String(Math.floor(start / 1000)),
      event,
      signature,
      attempt: attempts.length,
    });
    return {
      id: newId("dlv"),
      timestamp: new Date(start).toISOString(),
      event,
      url: cfg.url,
      method: cfg.method,
      mode: "simulated",
      scenario: spec.scenario,
      requestHeaders: headers,
      payload,
      signature,
      secretName: secret.name,
      finalStatus: last.status,
      finalStatusText: last.statusText,
      responseBody: seedBody(last.status),
      responseHeaders: { "Content-Type": last.status === 504 ? "text/html" : "application/json" },
      latencyMs: last.latencyMs,
      totalDurationMs: attempts.reduce((sum, a) => sum + a.latencyMs + a.backoffMs, 0),
      retryCount: attempts.length - 1,
      outcome: delivered ? "delivered" : "failed",
      attempts,
      error: undefined,
      config: cfg,
    };
  });
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (parsed.config && Array.isArray(parsed.secrets) && parsed.secrets.length > 0 && Array.isArray(parsed.logs)) {
        const base = defaultConfig(parsed.secrets[0].id);
        return {
          config: { ...base, ...parsed.config, retry: { ...base.retry, ...parsed.config.retry } },
          secrets: parsed.secrets,
          logs: parsed.logs,
        };
      }
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  const production = createSecret("Production");
  const staging = createSecret("Staging");
  const config = defaultConfig(production.id);
  return { config, secrets: [production, staging], logs: buildSeedLogs(config, production) };
}

interface StoreValue {
  state: AppState;
  activeSecret: Secret;
  tab: TabId;
  setTab: (tab: TabId) => void;
  updateConfig: (patch: Partial<DispatchConfig>) => void;
  addSecret: () => Secret;
  rotateSecret: (id: string) => void;
  renameSecret: (id: string, name: string) => void;
  deleteSecret: (id: string) => void;
  deleteLog: (id: string) => void;
  clearLogs: () => void;
  dispatchWebhook: (override?: DispatchConfig) => Promise<DeliveryLog | null>;
  dispatching: boolean;
  progress: DeliveryProgress | null;
  lastLog: DeliveryLog | null;
  verifierDraft: VerifierDraft | null;
  openVerifier: (draft: VerifierDraft) => void;
  consumeVerifierDraft: () => void;
  toasts: Toast[];
  toast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatchAction] = useReducer(reducer, undefined, loadState);
  const [tab, setTab] = useState<TabId>("dispatcher");
  const [dispatching, setDispatching] = useState(false);
  const [progress, setProgress] = useState<DeliveryProgress | null>(null);
  const [lastLog, setLastLog] = useState<DeliveryLog | null>(null);
  const [verifierDraft, setVerifierDraft] = useState<VerifierDraft | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const busy = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ config: state.config, secrets: state.secrets, logs: state.logs.slice(0, MAX_LOGS) }),
      );
    } catch {
      /* storage full or unavailable */
    }
  }, [state]);

  const toast = (message: string, tone: ToastTone = "info") => {
    const id = newId("toast");
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3600);
  };

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const activeSecret = state.secrets.find((s) => s.id === state.config.secretId) ?? state.secrets[0];

  const dispatchWebhook = async (override?: DispatchConfig): Promise<DeliveryLog | null> => {
    if (busy.current) {
      toast("A dispatch is already in flight", "info");
      return null;
    }
    const config = override ?? state.config;
    if (!isValidUrl(config.url)) {
      toast("Enter a valid http(s) endpoint URL before dispatching", "failure");
      return null;
    }
    const secret = state.secrets.find((s) => s.id === config.secretId) ?? state.secrets[0];
    busy.current = true;
    setDispatching(true);
    try {
      const log = await runDelivery({ config, secret, onProgress: setProgress });
      dispatchAction({ type: "addLog", log });
      setLastLog(log);
      const delivered = log.outcome === "delivered";
      toast(
        `${delivered ? "Delivered" : "Failed"} · ${log.finalStatus || "ERR"} ${log.finalStatusText} · ${formatMs(log.latencyMs)}${log.retryCount ? ` · ${log.retryCount} ${log.retryCount === 1 ? "retry" : "retries"}` : ""}`,
        delivered ? "success" : "failure",
      );
      return log;
    } catch (err) {
      toast(`Dispatch crashed: ${(err as Error).message}`, "failure");
      return null;
    } finally {
      busy.current = false;
      setDispatching(false);
      setProgress(null);
    }
  };

  const addSecret = () => {
    const secret = createSecret(`Secret ${state.secrets.length + 1}`);
    dispatchAction({ type: "addSecret", secret });
    toast(`Created ${secret.name}`, "success");
    return secret;
  };

  const rotateSecret = (id: string) => {
    dispatchAction({
      type: "updateSecret",
      id,
      patch: { value: `whsec_${randomHex(24)}`, rotatedAt: new Date().toISOString() },
    });
    toast("Secret rotated — update your receiver with the new value", "success");
  };

  const renameSecret = (id: string, name: string) => dispatchAction({ type: "updateSecret", id, patch: { name } });

  const deleteSecret = (id: string) => {
    if (state.secrets.length <= 1) {
      toast("At least one signing secret must remain", "failure");
      return;
    }
    dispatchAction({ type: "deleteSecret", id });
    toast("Secret deleted", "info");
  };

  const deleteLog = (id: string) => {
    dispatchAction({ type: "deleteLog", id });
    setLastLog((prev) => (prev?.id === id ? null : prev));
  };

  const clearLogs = () => {
    dispatchAction({ type: "clearLogs" });
    setLastLog(null);
    toast("Delivery history cleared", "info");
  };

  const openVerifier = (draft: VerifierDraft) => {
    setVerifierDraft(draft);
    setTab("verifier");
  };

  const value: StoreValue = {
    state,
    activeSecret,
    tab,
    setTab,
    updateConfig: (patch) => dispatchAction({ type: "config", patch }),
    addSecret,
    rotateSecret,
    renameSecret,
    deleteSecret,
    deleteLog,
    clearLogs,
    dispatchWebhook,
    dispatching,
    progress,
    lastLog,
    verifierDraft,
    openVerifier,
    consumeVerifierDraft: () => setVerifierDraft(null),
    toasts,
    toast,
    dismissToast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
