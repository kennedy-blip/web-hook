import { useMemo, useState } from "react";
import {
  Check,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Wand2,
  ListChecks,
} from "lucide-react";
import { useEffect } from "react";
import { useStore } from "@/store";
import { Button, Card, CopyButton, Field, formatDateTime, inputCls, monoInputCls, timeAgo, Segmented } from "@/components/ui";
import { hmacSha256Hex, timingSafeEqual } from "@/lib/crypto";
import { validateJson } from "@/lib/webhook";
import type { Secret } from "@/types";
import { cn } from "@/utils/cn";

const SNIPPETS = {
  node: `import crypto from "node:crypto";

// rawBody must be the exact bytes received (before JSON parsing)
export function verifyWebhook(rawBody, signatureHeader, secret) {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`,
  python: `import hmac
import hashlib

# raw_body: bytes exactly as received
def verify_webhook(raw_body: bytes, signature_header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header or "")`,
};

const TOLERANCES = [
  { value: "60", label: "60s" },
  { value: "300", label: "5 min" },
  { value: "900", label: "15 min" },
];

export function SignatureVerifier() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-white">Signature Verifier &amp; Secret Manager</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Recreate what your receiver does: recompute the HMAC-SHA256 digest over the raw body and compare it in constant time. Tamper with the payload or swap secrets to see failures.
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-2">
          <SecretManager />
        </div>
        <div className="space-y-6 xl:col-span-3">
          <VerifierPanel />
          <SnippetPanel />
        </div>
      </div>
    </div>
  );
}

function SecretManager() {
  const { state, updateConfig, addSecret, rotateSecret, renameSecret, deleteSecret } = useStore();
  const activeId = state.config.secretId;
  return (
    <Card
      title="Secret Manager"
      subtitle="HMAC keys stored only in this browser"
      icon={KeyRound}
      accent="violet"
      actions={
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => addSecret()}>
          New secret
        </Button>
      }
    >
      <div className="space-y-3">
        {state.secrets.map((s) => (
          <SecretRow
            key={s.id}
            secret={s}
            active={s.id === activeId}
            canDelete={state.secrets.length > 1}
            onActivate={() => updateConfig({ secretId: s.id })}
            onRotate={() => rotateSecret(s.id)}
            onRename={(name) => renameSecret(s.id, name)}
            onDelete={() => deleteSecret(s.id)}
          />
        ))}
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
        The highlighted secret signs outgoing dispatches. Rotating invalidates signatures made with the previous value.
      </p>
    </Card>
  );
}

function SecretRow({
  secret,
  active,
  canDelete,
  onActivate,
  onRotate,
  onRename,
  onDelete,
}: {
  secret: Secret;
  active: boolean;
  canDelete: boolean;
  onActivate: () => void;
  onRotate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition",
        active ? "border-violet-500/40 bg-violet-500/[0.06] shadow-lg shadow-violet-900/10" : "border-white/[0.07] bg-canvas/50",
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onActivate}
          aria-label={`Use ${secret.name} for signing`}
          aria-pressed={active}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition",
            active ? "border-violet-400 bg-violet-600" : "border-white/20 hover:border-violet-400/60",
          )}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </button>
        <input
          aria-label="Secret name"
          value={secret.name}
          onChange={(e) => onRename(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-100 outline-none focus:text-white"
        />
        {active && <span className="rounded-md bg-violet-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-300">ACTIVE</span>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-white/[0.06] bg-canvas px-3 py-2 font-mono text-[12px] text-slate-300">
          {reveal ? secret.value : `${secret.value.slice(0, 6)}${"•".repeat(20)}`}
        </code>
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? "Hide secret" : "Reveal secret"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white/[0.06] hover:text-white"
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
        <CopyButton text={secret.value} label="" className="px-2" />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">
          <Clock className="h-3 w-3" />
          created {timeAgo(secret.createdAt)}
          {secret.rotatedAt && <> · rotated {timeAgo(secret.rotatedAt)}</>}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={onRotate}>
            Rotate
          </Button>
          <Button size="sm" variant="ghost" icon={Trash2} disabled={!canDelete} onClick={onDelete} className="hover:text-rose-400">
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function VerifierPanel() {
  const { state, activeSecret, lastLog, verifierDraft, consumeVerifierDraft, toast } = useStore();
  const draft = verifierDraft;
  const [secretId, setSecretId] = useState(draft?.secretId ?? state.config.secretId);
  const [payload, setPayload] = useState(draft?.payload ?? state.config.payload);
  const [signature, setSignature] = useState(draft?.signature ?? "");
  const [timestamp, setTimestamp] = useState("");
  const [tolerance, setTolerance] = useState("300");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    consumeVerifierDraft();
    // Draft is consumed once on mount so re-visits start from the current config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secret = state.secrets.find((s) => s.id === secretId) ?? activeSecret;
  const expected = useMemo(() => `sha256=${hmacSha256Hex(secret.value, payload)}`, [secret.value, payload]);
  const received = signature.trim();
  const hasSignature = received.length > 0;
  const signatureMatch = hasSignature && timingSafeEqual(received, expected);

  const tsNum = Number(timestamp);
  const hasTs = timestamp.trim() !== "" && Number.isFinite(tsNum);
  const ageSec = hasTs ? Math.floor(now / 1000) - tsNum : 0;
  const withinWindow = !hasTs || Math.abs(ageSec) <= Number(tolerance);

  type Verdict = "awaiting" | "verified" | "stale" | "mismatch";
  const verdict: Verdict = !hasSignature ? "awaiting" : !signatureMatch ? "mismatch" : withinWindow ? "verified" : "stale";

  const tamper = () => {
    const parsed = validateJson(payload);
    if (parsed.ok && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)) {
      const obj = { ...(parsed.value as Record<string, unknown>), _tampered: true };
      setPayload(JSON.stringify(obj, null, 2));
    } else {
      setPayload(payload + " ");
    }
    toast("Payload modified — the signature no longer matches", "info");
  };

  const loadFromLastDispatch = () => {
    const source = lastLog ?? state.logs.find((l) => l.signature);
    if (!source || !source.signature) {
      toast("No signed dispatch found yet", "failure");
      return;
    }
    setPayload(source.payload);
    setSignature(source.signature);
    setSecretId(source.config.secretId);
    toast("Loaded payload and signature from the last dispatch", "success");
  };

  const verdictStyles: Record<Verdict, { ring: string; text: string; title: string; desc: string; icon: typeof CircleCheck }> = {
    awaiting: { ring: "border-white/10 bg-white/[0.03]", text: "text-slate-300", title: "Awaiting signature", desc: "Paste the X-Hub-Signature-256 header or sign the payload below.", icon: ShieldCheck },
    verified: { ring: "border-emerald-500/30 bg-emerald-500/10", text: "text-emerald-300", title: "Signature verified", desc: "Digest matches. The payload is authentic for this secret.", icon: CircleCheck },
    stale: { ring: "border-amber-500/30 bg-amber-500/10", text: "text-amber-300", title: "Valid signature · outside replay window", desc: `Timestamp is ${Math.abs(ageSec)}s away from now, beyond the ${tolerance}s tolerance. Possible replay.`, icon: TriangleAlert },
    mismatch: { ring: "border-rose-500/30 bg-rose-500/10", text: "text-rose-300", title: "Signature mismatch", desc: "Rejected: digest differs. Wrong secret, altered body, or re-encoded JSON.", icon: CircleX },
  };
  const vs = verdictStyles[verdict];
  const VerdictIcon = vs.icon;

  return (
    <Card
      title="Verify a Signature"
      subtitle="Constant-time comparison against an HMAC-SHA256 recomputation"
      icon={ShieldCheck}
      accent="emerald"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={ListChecks} onClick={loadFromLastDispatch}>
            Load last dispatch
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Verifying secret">
            <select
              aria-label="Verifying secret"
              value={secret.id}
              onChange={(e) => setSecretId(e.target.value)}
              className={cn(inputCls, "cursor-pointer")}
            >
              {state.secrets.map((s) => (
                <option key={s.id} value={s.id} className="bg-panel">
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="X-WebhookPulse-Timestamp" hint={hasTs ? `Signed ${timeAgo(new Date(tsNum * 1000).toISOString())} · ${formatDateTime(new Date(tsNum * 1000).toISOString())}` : "Optional unix seconds for replay protection."}>
            <div className="flex gap-2">
              <input
                aria-label="Timestamp"
                value={timestamp}
                placeholder="e.g. 1735689600"
                inputMode="numeric"
                onChange={(e) => setTimestamp(e.target.value.replace(/[^0-9]/g, ""))}
                className={cn(monoInputCls, "min-w-0 flex-1")}
              />
              <Button size="sm" variant="secondary" onClick={() => setTimestamp(String(Math.floor(Date.now() / 1000)))}>
                Now
              </Button>
            </div>
          </Field>
        </div>

        <Field label="Raw payload (exact bytes)">
          <textarea
            aria-label="Payload to verify"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            spellCheck={false}
            rows={6}
            className={cn(monoInputCls, "resize-y leading-relaxed text-emerald-100/90")}
          />
        </Field>

        <Field label="Received X-Hub-Signature-256">
          <input
            aria-label="Received signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="sha256=…"
            spellCheck={false}
            className={cn(monoInputCls, "text-violet-200")}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" icon={Wand2} onClick={() => setSignature(expected)}>
            Sign with “{secret.name}”
          </Button>
          <Button size="sm" variant="amber" icon={FlaskConical} onClick={tamper}>
            Tamper payload
          </Button>
          <Button size="sm" variant="secondary" icon={Copy} onClick={() => setSignature(expected.replace(/.$/, (c) => (c === "0" ? "1" : "0")))}>
            Flip one digit
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-500">Tolerance</span>
            <Segmented options={TOLERANCES} value={tolerance as "60" | "300" | "900"} onChange={setTolerance} />
          </div>
        </div>

        {/* Verdict */}
        <div className={cn("space-y-4 rounded-xl border p-5 transition", vs.ring)}>
          <div className="flex items-start gap-3">
            <VerdictIcon className={cn("mt-0.5 h-6 w-6 shrink-0", vs.text)} />
            <div className="min-w-0">
              <p className={cn("text-base font-semibold", vs.text)}>{vs.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{vs.desc}</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">Expected (recomputed)</p>
            <p className="break-all rounded-lg bg-canvas/70 p-3 font-mono text-[12px] leading-relaxed">
              {expected.split("").map((ch, i) => {
                const match = hasSignature && received[i] === ch;
                return (
                  <span key={i} className={hasSignature ? (match ? "text-emerald-400" : "text-rose-400") : "text-slate-300"}>
                    {ch}
                  </span>
                );
              })}
            </p>
            {hasSignature && (
              <>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500">Received</p>
                <p className="break-all rounded-lg bg-canvas/70 p-3 font-mono text-[12px] leading-relaxed text-slate-400">{received}</p>
              </>
            )}
          </div>

          {hasTs && (
            <p className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
              <Clock className="h-3.5 w-3.5" />
              age {ageSec}s · {withinWindow ? <span className="text-emerald-400">inside ±{tolerance}s window</span> : <span className="text-amber-400">outside ±{tolerance}s window</span>}
            </p>
          )}
          {verdict === "verified" && (
            <p className="flex items-center gap-2 text-xs text-emerald-300/80">
              <Check className="h-3.5 w-3.5" /> All {expected.length - 7} hex characters matched in constant time.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function SnippetPanel() {
  const [lang, setLang] = useState<"node" | "python">("node");
  const code = SNIPPETS[lang];
  return (
    <Card
      title="Receiver Verification Snippet"
      subtitle="Drop-in verification for your webhook endpoint"
      icon={Copy}
      accent="slate"
      actions={
        <div className="flex items-center gap-2">
          <Segmented
            options={[
              { value: "node", label: "Node.js" },
              { value: "python", label: "Python" },
            ]}
            value={lang}
            onChange={setLang}
          />
          <CopyButton text={code} label="Copy" />
        </div>
      }
    >
      <pre className="max-h-80 overflow-auto rounded-lg border border-white/[0.06] bg-canvas p-4 font-mono text-[12px] leading-relaxed text-slate-300">{code}</pre>
      <p className="mt-3 text-xs text-slate-500">Always verify the raw request body before JSON parsing, and use a constant-time comparison to avoid timing leaks.</p>
    </Card>
  );
}
