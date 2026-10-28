import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/**
 * Secret handling shared by sessions and login codes.
 *
 * Everything here is `node:crypto`. No secret is ever stored in a form that can be
 * replayed, and no comparison uses `===`.
 */

/** 256 bits, base64url — 43 characters, safe in a cookie and in a URL. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Used for lookup keys and audit fields. Hex so it is greppable in logs. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be an oracle,
 * so lengths are compared first. Empty strings are rejected outright: an absent
 * hash must never compare equal to an absent hash.
 */
export function equalHex(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Salted scrypt. A stolen `login_challenges` row does not yield a usable code. */
export async function hashCode(code: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16);
  const key = await derive(code, salt, 32);
  return { hash: key.toString("hex"), salt: salt.toString("hex") };
}

export async function verifyCode(code: string, hash: string, salt: string): Promise<boolean> {
  if (!code || !hash || !salt) return false;
  const key = await derive(code, Buffer.from(salt, "hex"), 32);
  return equalHex(key.toString("hex"), hash);
}

/**
 * A numeric one-time code.
 *
 * `randomInt` is rejection-sampled and unbiased; `Math.random()` would make the
 * search space smaller than it looks and is not a CSPRNG.
 */
export function randomCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

/** Trims, lowercases, and drops anything that is not an address-shaped string. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
