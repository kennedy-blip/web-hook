import type { HttpMethod, ReceiverScenario, RetryPolicy } from "@/types";
import { randomHex } from "./crypto";

export const METHODS: HttpMethod[] = ["POST", "PUT", "PATCH"];

/** Status codes that are considered transient and therefore retried. 0 = network error. */
export const RETRYABLE_STATUSES = [0, 408, 425, 429, 500, 502, 503, 504];
const RETRYABLE = new Set(RETRYABLE_STATUSES);

export type Tone = "success" | "retry" | "failure";

export function statusTone(status: number): Tone {
  if (status >= 200 && status < 300) return "success";
  if (RETRYABLE.has(status)) return "retry";
  return "failure";
}

export function isRetryable(status: number): boolean {
  return RETRYABLE.has(status);
}

const REASONS: Record<number, string> = {
  0: "Network Error",
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  413: "Payload Too Large",
  422: "Unprocessable Entity",
  425: "Too Early",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function reasonPhrase(status: number): string {
  if (REASONS[status]) return REASONS[status];
  if (status >= 500) return "Server Error";
  if (status >= 400) return "Client Error";
  if (status >= 300) return "Redirect";
  if (status >= 200) return "Success";
  return "Unknown";
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export const SCENARIOS: { id: ReceiverScenario; label: string; description: string }[] = [
  { id: "ok", label: "200 OK — healthy receiver", description: "Receiver accepts the payload immediately." },
  { id: "bad_request", label: "400 Bad Request — schema rejected", description: "Permanent failure; retries are skipped." },
  { id: "gateway_timeout", label: "504 Gateway Timeout — upstream stall", description: "Transient failure; retried with backoff." },
  { id: "server_error", label: "500 Internal Server Error", description: "Transient server fault; retried with backoff." },
  { id: "service_unavailable", label: "503 Service Unavailable", description: "Maintenance / overload; retried with backoff." },
  { id: "rate_limited", label: "429 Too Many Requests", description: "Throttled by the receiver; retried with backoff." },
  { id: "network_error", label: "Network error — connection reset", description: "Socket dropped before any response (ECONNRESET)." },
  { id: "flaky", label: "Flaky — fails N times, then recovers", description: "Returns 504 for the first N attempts, then 200 OK." },
];

export interface ReceiverResponse {
  status: number;
  statusText: string;
  latencyMs: number;
  body: string;
  headers: Record<string, string>;
  error?: string;
}

const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

function okResponse(): ReceiverResponse {
  return {
    status: 200,
    statusText: "OK",
    latencyMs: rand(90, 260),
    body: JSON.stringify({ status: "received", receipt: `rcpt_${randomHex(6)}` }),
    headers: { "Content-Type": "application/json", "X-Receiver": "mock-edge-01" },
  };
}

function gatewayTimeout(): ReceiverResponse {
  return {
    status: 504,
    statusText: "Gateway Timeout",
    latencyMs: rand(1400, 2600),
    body: "<html>\n<head><title>504 Gateway Time-out</title></head>\n<body>\n<h1>504 Gateway Time-out</h1>\n<p>The upstream server did not respond in time.</p>\n</body>\n</html>",
    headers: { "Content-Type": "text/html", Server: "nginx/1.25.3" },
  };
}

/** Simulates a remote webhook receiver for a given scenario and attempt number. */
export function simulateReceiver(scenario: ReceiverScenario, attempt: number, recoverAfter: number): ReceiverResponse {
  switch (scenario) {
    case "bad_request":
      return {
        status: 400,
        statusText: "Bad Request",
        latencyMs: rand(30, 110),
        body: JSON.stringify({ error: "validation_failed", message: "Field 'data.object.id' is required" }),
        headers: { "Content-Type": "application/json" },
      };
    case "gateway_timeout":
      return gatewayTimeout();
    case "server_error":
      return {
        status: 500,
        statusText: "Internal Server Error",
        latencyMs: rand(180, 520),
        body: JSON.stringify({ error: "internal_error", request_id: `req_${randomHex(5)}` }),
        headers: { "Content-Type": "application/json" },
      };
    case "service_unavailable":
      return {
        status: 503,
        statusText: "Service Unavailable",
        latencyMs: rand(250, 800),
        body: JSON.stringify({ error: "service_unavailable", retry_after: 2 }),
        headers: { "Content-Type": "application/json", "Retry-After": "2" },
      };
    case "rate_limited":
      return {
        status: 429,
        statusText: "Too Many Requests",
        latencyMs: rand(40, 120),
        body: JSON.stringify({ error: "rate_limited", retry_after: 1 }),
        headers: { "Content-Type": "application/json", "Retry-After": "1" },
      };
    case "network_error":
      return {
        status: 0,
        statusText: "Network Error",
        latencyMs: rand(4, 40),
        body: "",
        headers: {},
        error: "ECONNRESET: socket hang up",
      };
    case "flaky":
      return attempt <= recoverAfter ? gatewayTimeout() : okResponse();
    case "ok":
    default:
      return okResponse();
  }
}

/** Base exponential backoff for retry index n (1-based): min(maxDelay, base * multiplier^(n-1)). */
export function rawBackoff(retryIndex: number, p: RetryPolicy): number {
  return Math.min(p.maxDelayMs, p.baseDelayMs * Math.pow(p.multiplier, Math.max(0, retryIndex - 1)));
}

/** Actual delay for retry n, applying "equal jitter" (half fixed, half random) when enabled. */
export function backoffDelay(retryIndex: number, p: RetryPolicy, rng: () => number = Math.random): number {
  const raw = rawBackoff(retryIndex, p);
  return Math.round(p.jitter ? raw / 2 + rng() * (raw / 2) : raw);
}

export function backoffSchedule(p: RetryPolicy): number[] {
  return Array.from({ length: p.maxRetries }, (_, i) => Math.round(rawBackoff(i + 1, p)));
}

export interface PayloadTemplate {
  id: string;
  label: string;
  description: string;
  build: () => Record<string, unknown>;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export const TEMPLATES: PayloadTemplate[] = [
  {
    id: "customer.created",
    label: "customer.created",
    description: "A new customer account was registered",
    build: () => ({
      id: `evt_${randomHex(8)}`,
      type: "customer.created",
      created: nowSec(),
      livemode: false,
      data: {
        object: {
          id: `cus_${randomHex(6)}`,
          email: "ada@example.com",
          name: "Ada Lovelace",
          plan: "starter",
          metadata: { source: "WebhookPulse" },
        },
      },
    }),
  },
  {
    id: "subscription.renewed",
    label: "subscription.renewed",
    description: "A subscription successfully renewed for a new period",
    build: () => ({
      id: `evt_${randomHex(8)}`,
      type: "subscription.renewed",
      created: nowSec(),
      livemode: false,
      data: {
        object: {
          id: `sub_${randomHex(6)}`,
          customer: `cus_${randomHex(6)}`,
          status: "active",
          plan: { name: "Pro", interval: "month", amount: 4900, currency: "usd" },
          current_period_end: nowSec() + 30 * 24 * 3600,
        },
      },
    }),
  },
  {
    id: "payment.failed",
    label: "payment.failed",
    description: "A charge attempt was declined by the card network",
    build: () => ({
      id: `evt_${randomHex(8)}`,
      type: "payment.failed",
      created: nowSec(),
      livemode: false,
      data: {
        object: {
          id: `pi_${randomHex(6)}`,
          amount: 12900,
          currency: "usd",
          failure_code: "card_declined",
          attempt_count: 2,
          next_attempt_at: nowSec() + 3 * 24 * 3600,
        },
      },
    }),
  },
  {
    id: "order.shipped",
    label: "order.shipped",
    description: "An order left the warehouse with a tracking number",
    build: () => ({
      id: `evt_${randomHex(8)}`,
      type: "order.shipped",
      created: nowSec(),
      livemode: false,
      data: {
        object: {
          id: `ord_${randomHex(6)}`,
          carrier: "UPS",
          tracking_number: "1Z999AA10123456784",
          items: [{ sku: "SKU-1042", qty: 2 }],
          shipped_at: nowSec(),
        },
      },
    }),
  },
];

export function buildTemplatePayload(id: string): string {
  const template = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
  return JSON.stringify(template.build(), null, 2);
}

export function detectEvent(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      const value = rec.type ?? rec.event;
      if (typeof value === "string" && value) return value;
    }
  } catch {
    /* not JSON — fall through */
  }
  return "webhook.dispatched";
}
