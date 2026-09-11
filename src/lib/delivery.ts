import type { Attempt, DeliveryLog, DispatchConfig, Secret } from "@/types";
import { hmacSha256Hex, newId, uuid } from "./crypto";
import {
  backoffDelay,
  detectEvent,
  isRetryable,
  reasonPhrase,
  simulateReceiver,
  statusTone,
  type ReceiverResponse,
} from "./webhook";

export interface DeliveryProgress {
  phase: "sending" | "waiting";
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
}

interface RunArgs {
  config: DispatchConfig;
  secret: Secret | undefined;
  onProgress?: (p: DeliveryProgress) => void;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function computeSignature(payload: string, secret: Secret): string {
  return `sha256=${hmacSha256Hex(secret.value, payload)}`;
}

interface HeaderMeta {
  deliveryId: string;
  timestamp: string;
  event: string;
  signature: string | null;
  attempt: number;
}

/** Builds the full request header set: user headers first, then WebhookPulse system headers. */
export function buildHeaders(config: DispatchConfig, meta: HeaderMeta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of config.headers) {
    const key = h.key.trim();
    if (h.enabled && key) out[key] = h.value;
  }
  out["X-WebhookPulse-Event"] = meta.event;
  out["X-WebhookPulse-Delivery"] = meta.deliveryId;
  out["X-WebhookPulse-Timestamp"] = meta.timestamp;
  out["X-WebhookPulse-Attempt"] = String(meta.attempt);
  if (meta.signature) out["X-Hub-Signature-256"] = meta.signature;
  return out;
}

export function buildCurl(config: DispatchConfig, secret: Secret | undefined): string {
  const signature = config.signed && secret ? computeSignature(config.payload, secret) : null;
  const headers = buildHeaders(config, {
    deliveryId: "<delivery-uuid>",
    timestamp: "<unix-timestamp>",
    event: detectEvent(config.payload),
    signature,
    attempt: 1,
  });
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const lines = [`curl -X ${config.method} ${quote(config.url)}`];
  for (const [k, v] of Object.entries(headers)) lines.push(`  -H ${quote(`${k}: ${v}`)}`);
  lines.push(`  --data-raw ${quote(config.payload)}`);
  return lines.join(" \\\n");
}

async function liveRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<ReceiverResponse> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { method, headers, body, signal: controller.signal, mode: "cors" });
    const text = await res.text();
    const resHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      resHeaders[key] = value;
    });
    return {
      status: res.status,
      statusText: res.statusText || reasonPhrase(res.status),
      latencyMs: Math.round(performance.now() - started),
      body: text.slice(0, 5000),
      headers: resHeaders,
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    const message = aborted
      ? "Timed out after 10s with no response"
      : `${(err as Error).message} — the browser may have blocked the request (CORS, DNS or mixed content)`;
    return {
      status: 0,
      statusText: "Network Error",
      latencyMs: Math.round(performance.now() - started),
      body: "",
      headers: {},
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function simulatedRequest(config: DispatchConfig, attempt: number): Promise<ReceiverResponse> {
  const response = simulateReceiver(config.scenario, attempt, config.flakyRecoverAfter);
  await sleep(response.latencyMs);
  return response;
}

/** Executes a full delivery, including exponential-backoff retries, and returns a log entry. */
export async function runDelivery({ config, secret, onProgress }: RunArgs): Promise<DeliveryLog> {
  const startedAt = Date.now();
  const timestamp = new Date().toISOString();
  const event = detectEvent(config.payload);
  const signature = config.signed && secret ? computeSignature(config.payload, secret) : null;
  const deliveryId = uuid();
  const unixTs = String(Math.floor(Date.now() / 1000));
  const maxAttempts = config.retry.enabled ? config.retry.maxRetries + 1 : 1;

  const attempts: Attempt[] = [];
  let last: ReceiverResponse = { status: 0, statusText: "Network Error", latencyMs: 0, body: "", headers: {} };
  let lastHeaders: Record<string, string> = {};
  let delivered = false;

  for (let n = 1; n <= maxAttempts; n++) {
    let backoffMs = 0;
    if (n > 1) {
      backoffMs = backoffDelay(n - 1, config.retry);
      onProgress?.({ phase: "waiting", attempt: n, maxAttempts, delayMs: backoffMs });
      await sleep(backoffMs);
    }
    onProgress?.({ phase: "sending", attempt: n, maxAttempts });

    const headers = buildHeaders(config, { deliveryId, timestamp: unixTs, event, signature, attempt: n });
    const response =
      config.mode === "simulated"
        ? await simulatedRequest(config, n)
        : await liveRequest(config.url, config.method, headers, config.payload);

    const retryable = isRetryable(response.status);
    attempts.push({
      attempt: n,
      status: response.status,
      statusText: response.statusText || reasonPhrase(response.status),
      latencyMs: response.latencyMs,
      backoffMs,
      retryable,
      error: response.error,
      timestamp: new Date().toISOString(),
    });
    last = response;
    lastHeaders = headers;

    if (statusTone(response.status) === "success") {
      delivered = true;
      break;
    }
    if (!retryable) break;
  }

  return {
    id: newId("dlv"),
    timestamp,
    event,
    url: config.url,
    method: config.method,
    mode: config.mode,
    scenario: config.scenario,
    requestHeaders: lastHeaders,
    payload: config.payload,
    signature,
    secretName: signature && secret ? secret.name : null,
    finalStatus: last.status,
    finalStatusText: last.statusText || reasonPhrase(last.status),
    responseBody: last.body,
    responseHeaders: last.headers,
    latencyMs: last.latencyMs,
    totalDurationMs: Date.now() - startedAt,
    retryCount: attempts.length - 1,
    outcome: delivered ? "delivered" : "failed",
    attempts,
    error: last.error,
    config: JSON.parse(JSON.stringify(config)) as DispatchConfig,
  };
}
