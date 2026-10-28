import type { RateLimitOptions } from "../rate-limit";

/**
 * Auth endpoints get their own budgets rather than sharing the page traffic window.
 *
 * These are per-process and per-caller, so they are a speed bump, not the guarantee.
 * The guarantee is in the database: a challenge carries its own attempt counter that
 * survives a restart, and the code is single-use and time-limited.
 */
export const AUTH_START_LIMIT: RateLimitOptions = { bucket: "auth-start", limit: 10, windowMs: 5 * 60 * 1000 };
export const AUTH_CALLBACK_LIMIT: RateLimitOptions = { bucket: "auth-callback", limit: 10, windowMs: 5 * 60 * 1000 };
export const AUTH_CODE_LIMIT: RateLimitOptions = { bucket: "auth-code", limit: 12, windowMs: 5 * 60 * 1000 };
export const AUTH_RESEND_LIMIT: RateLimitOptions = { bucket: "auth-resend", limit: 3, windowMs: 10 * 60 * 1000 };
export const AUTH_LOGOUT_LIMIT: RateLimitOptions = { bucket: "auth-logout", limit: 20, windowMs: 60 * 1000 };
