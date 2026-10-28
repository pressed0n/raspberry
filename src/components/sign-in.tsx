"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { RequestError, request } from "@/lib/api-client";

/**
 * Sign-in screens.
 *
 * The Google button is a plain link, not a script. That keeps `script-src` free of
 * accounts.google.com, which is one less third-party origin able to run code on the
 * page that handles a session cookie.
 */
const NEXT_KEY = "raspberry.next";

/** Only a path on this site. `//host` and `https://…` are redirects somewhere else. */
export function safePath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

const reasons: Record<string, string> = {
  expired: "That sign-in attempt expired. Start again.",
  denied: "Google sign-in was cancelled.",
  not_allowed: "That account is not on this server's allowlist.",
  email_unverified: "That Google account has no verified email address.",
  google_exchange_failed: "Google did not complete the sign-in. Try again.",
  google_userinfo_failed: "Google did not confirm that account. Try again.",
  mail_failed: "The code could not be emailed. Try again in a moment.",
  error: "Something went wrong. Try again.",
};

const card: React.CSSProperties = { minHeight: "100dvh", display: "grid", placeItems: "center", padding: "32px 20px", background: "#f7f7f4", color: "#26261f" };
const panel: React.CSSProperties = { width: "100%", maxWidth: "380px", background: "#fff", border: "1px solid #e6e4dc", borderRadius: "18px", padding: "28px", boxShadow: "0 12px 40px rgba(38,38,31,0.06)" };
const mark: React.CSSProperties = { display: "block", fontSize: "22px", letterSpacing: "-0.02em", marginBottom: "6px" };
const lede: React.CSSProperties = { margin: "0 0 22px", color: "#6b6a60", fontSize: "14px", lineHeight: 1.5 };
const action: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", width: "100%", padding: "11px 16px", borderRadius: "11px", border: "1px solid #d9d6cd", background: "#26261f", color: "#f7f7f4", fontSize: "14px", fontWeight: 600, textDecoration: "none", cursor: "pointer" };
const note: React.CSSProperties = { marginTop: "18px", fontSize: "12.5px", lineHeight: 1.55, color: "#8b897e" };
const bad: React.CSSProperties = { margin: "0 0 16px", padding: "10px 12px", borderRadius: "10px", background: "#fdf0ef", border: "1px solid #f3d6d3", color: "#8c3b34", fontSize: "13px", lineHeight: 1.45 };

export function SignInPanel({ error, next }: { error?: string; next?: string }) {
  useEffect(() => {
    // Survives the Google round trip, which will not carry a query string back to us.
    const target = safePath(next);
    if (target) {
      try { sessionStorage.setItem(NEXT_KEY, target); } catch { /* Private mode: fall back to the home page. */ }
    }
  }, [next]);

  const message = error ? (reasons[error] ?? reasons.error) : null;

  return (
    <div style={card}>
      <div style={panel}>
        <strong style={mark}>Raspberry.</strong>
        <p style={lede}>A quiet home for your notes. Sign in with the Google account this server was set up for.</p>
        {message && <p style={bad} role="alert">{message}</p>}
        <a style={action} href="/api/auth/google/start">Continue with Google</a>
        <p style={note}>You will be emailed a 6-digit code next. Both are required — the Google account alone is not enough to get in.</p>
      </div>
    </div>
  );
}

export function CodePanel() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await request("/api/auth/verify-code", { method: "POST", body: JSON.stringify({ code }) });
      let target: string | null = null;
      try {
        target = safePath(sessionStorage.getItem(NEXT_KEY));
        sessionStorage.removeItem(NEXT_KEY);
      } catch { /* Private mode. */ }
      window.location.assign(target ?? "/");
    } catch (failure) {
      setError(failure instanceof RequestError ? failure.message : "That code could not be checked. Try again.");
      setBusy(false);
      setCode("");
      input.current?.focus();
    }
  }

  async function resend() {
    setSent("");
    try {
      await request("/api/auth/resend", { method: "POST" });
      setSent("A new code is on its way.");
    } catch (failure) {
      setError(failure instanceof RequestError ? failure.message : "The code could not be re-sent.");
    }
  }

  return (
    <div style={card}>
      <div style={panel}>
        <strong style={mark}>Raspberry.</strong>
        <p style={lede}>Enter the 6-digit code we emailed you. It expires in five minutes and works once.</p>
        <form onSubmit={submit}>
          {error && <p style={bad} role="alert">{error}</p>}
          {sent && <p style={{ ...bad, background: "#f1f6f1", borderColor: "#d8e6d8", color: "#3d6b3f" }} role="status">{sent}</p>}
          <label htmlFor="code" style={{ display: "block", fontSize: "12.5px", color: "#6b6a60", marginBottom: "6px" }}>Sign-in code</label>
          <input
            id="code"
            ref={input}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
            style={{ width: "100%", padding: "12px 14px", fontSize: "20px", letterSpacing: "0.32em", textAlign: "center", borderRadius: "11px", border: "1px solid #d9d6cd", background: "#fdfdfb", color: "#26261f" }}
          />
          <button type="submit" style={{ ...action, marginTop: "14px", opacity: busy || code.length !== 6 ? 0.6 : 1 }} disabled={busy || code.length !== 6}>
            {busy ? <><LoaderCircle size={16} className="spin" /> Checking…</> : "Enter Raspberry"}
          </button>
        </form>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "16px", fontSize: "12.5px" }}>
          <button type="button" onClick={() => void resend()} style={{ background: "none", border: 0, padding: 0, color: "#6b6a60", cursor: "pointer", textDecoration: "underline" }}>Send a new code</button>
          <a href="/login" style={{ color: "#6b6a60" }}>Start over</a>
        </div>
        <p style={note}>No code? Check spam, then send a new one. Codes are single use: an older one stops working the moment a new one is sent.</p>
      </div>
    </div>
  );
}
