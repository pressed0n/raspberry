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
 *
 * Styling is class-based and reads from the same tokens as the app, so the sign-in
 * screens follow the theme instead of pinning their own colours.
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
    <div className="auth">
      <div className="auth-panel">
        <strong className="auth-mark">Raspberry</strong>
        <p className="auth-lede">Sign in with the Google account this server was set up for.</p>
        {message && <p className="auth-alert" role="alert">{message}</p>}
        <a className="btn-primary auth-action" href="/api/auth/google/start">Continue with Google</a>
        <p className="auth-note">You will be emailed a 6-digit code next. Both are required — the Google account alone is not enough to get in.</p>
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
    <div className="auth">
      <div className="auth-panel">
        <strong className="auth-mark">Raspberry</strong>
        <p className="auth-lede">Enter the 6-digit code we emailed you. It expires in five minutes and works once.</p>
        <form onSubmit={submit}>
          {error && <p className="auth-alert" role="alert">{error}</p>}
          {sent && <p className="auth-alert is-good" role="status">{sent}</p>}
          <label htmlFor="code" className="auth-label">Sign-in code</label>
          <input
            id="code"
            ref={input}
            className="auth-code"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="123456"
          />
          <button type="submit" className="btn-primary auth-action" disabled={busy || code.length !== 6}>
            {busy ? <><LoaderCircle size={15} className="spin" />Checking…</> : "Enter Raspberry"}
          </button>
        </form>
        <div className="auth-links">
          <button type="button" onClick={() => void resend()}>Send a new code</button>
          <a href="/login">Start over</a>
        </div>
        <p className="auth-note">No code? Check spam, then send a new one. Codes are single use: an older one stops working the moment a new one is sent.</p>
      </div>
    </div>
  );
}
