export type HttpMethod = "POST" | "PUT" | "PATCH";
export type DeliveryMode = "simulated" | "live";
export type DeliveryOutcome = "delivered" | "failed";
export type ReceiverScenario =
  | "ok"
  | "bad_request"
  | "gateway_timeout"
  | "server_error"
  | "service_unavailable"
  | "rate_limited"
  | "network_error"
  | "flaky";

export interface HeaderEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  jitter: boolean;
}

export interface DispatchConfig {
  url: string;
  method: HttpMethod;
  headers: HeaderEntry[];
  payload: string;
  templateId: string;
  mode: DeliveryMode;
  scenario: ReceiverScenario;
  flakyRecoverAfter: number;
  signed: boolean;
  secretId: string;
  retry: RetryPolicy;
}

export interface Secret {
  id: string;
  name: string;
  value: string;
  createdAt: string;
  rotatedAt?: string;
}

export interface Attempt {
  attempt: number;
  status: number;
  statusText: string;
  latencyMs: number;
  backoffMs: number;
  retryable: boolean;
  error?: string;
  timestamp: string;
}

export interface DeliveryLog {
  id: string;
  timestamp: string;
  event: string;
  url: string;
  method: HttpMethod;
  mode: DeliveryMode;
  scenario: ReceiverScenario;
  requestHeaders: Record<string, string>;
  payload: string;
  signature: string | null;
  secretName: string | null;
  finalStatus: number;
  finalStatusText: string;
  responseBody: string;
  responseHeaders: Record<string, string>;
  latencyMs: number;
  totalDurationMs: number;
  retryCount: number;
  outcome: DeliveryOutcome;
  attempts: Attempt[];
  error?: string;
  config: DispatchConfig;
}
