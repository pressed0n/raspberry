import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { accessMode, requestAccessError } from "./access";
import { rateLimitError } from "./rate-limit";
import { AppError, type Actor } from "./service";
import { resolveActor } from "./session";

export type ApiContext = { actor: Actor; requestId: string };

export async function api(request: Request, work: (context: ApiContext) => Promise<unknown>) {
  const requestId = randomUUID();
  try {
    const denied = requestAccessError(request.headers, request.method);
    if (denied) throw new AppError(403, accessMode() === "local" ? "local_only" : "access_denied", denied);
    const limited = rateLimitError(request.headers, request.method);
    if (limited) throw new AppError(429, "rate_limited", limited);
    const actor = await resolveActor(request);
    const result = await work({ actor, requestId });
    return json(result, 200, requestId);
  } catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status, requestId);
    if (error instanceof z.ZodError) return json({ error: { code: "invalid_input", message: error.issues[0]?.message ?? "Invalid input." } }, 400, requestId);
    console.error("Raspberry request failed", requestId, error instanceof Error ? error.name : "UnknownError");
    return json({ error: { code: "internal_error", message: "Something went wrong. Your draft has been kept." } }, 500, requestId);
  }
}
function json(body: unknown, status: number, requestId: string) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
}
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError(415, "content_type", "Send JSON content.");
  const reader = request.body?.getReader(); if (!reader) throw new AppError(400, "empty_body", "Request body is required.");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read(); if (result.done) break;
    size += result.value.byteLength;
    if (size > 1_000_000) { await reader.cancel(); throw new AppError(413, "too_large", "This page exceeds the 1 MB prototype limit."); }
    chunks.push(result.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "invalid_json", "Request contains invalid JSON."); }
}
export function pageId(id: string): string { return z.string().uuid().parse(id); }
