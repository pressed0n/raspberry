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
  not_allowed: "That address is not on this server's allowlist.",
  no_account: "That address is allowed in, but has no account on this server yet.",
  email_unverified: "That Google account has no verified email address.",
  google_exchange_failed: "Google did not complete the sign-in. Try again.",
  google_userinfo_failed: "Google did not confirm that account. Try again.",
  mail_failed: "The code could not be emailed. Try again in a moment.",
  error: "Something went wrong. Try again.",
};

/**
 * Sign-in, step one: the address.
 *
 * There is no button for a provider here and nothing loads from a third-party origin —
 * the address goes up, the server decides, and a code either arrives or it does not. That
 * is also why this form is a real `<form>` rather than a link: it is one field and one
 * decision, and Enter in the field has to work.
 */
export function SignInPanel({ error, next }: { error?: string; next?: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    // Survives the round trip to the code screen, which does not carry a query string.
    const target = safePath(next);
    if (target) {
      try { sessionStorage.setItem(NEXT_KEY, target); } catch { /* Private mode: fall back to the home page. */ }
    }
  }, [next]);

  const message = failure || (error ? (reasons[error] ?? reasons.error) : "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setFailure("");
    try {
      await request("/api/auth/start", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      window.location.assign("/login/code");
    } catch (thrown) {
      setFailure(thrown instanceof RequestError ? thrown.message : "That address could not be checked. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-panel">
        <strong className="auth-mark">Raspberry</strong>
        <p className="auth-lede">Enter the email address this server knows you by.</p>
        <form onSubmit={submit}>
          {message && <p className="auth-alert" role="alert">{message}</p>}
          <label htmlFor="email" className="auth-label">Email address</label>
          <input
            id="email"
            ref={input}
            className="auth-input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
          />
          <button type="submit" className="btn-primary auth-action" disabled={busy || !email.trim()}>
            {busy ? <><LoaderCircle size={15} className="spin" />Sending…</> : "Email me a code"}
          </button>
        </form>
        <p className="auth-note">We will email a 6-digit code that expires in five minutes and works once. Only addresses that already have an account here can sign in.</p>
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
