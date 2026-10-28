import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, localActor } from "./service";
import { localAccessError } from "./local-access";

export const browserActor = localActor("browser");
export async function api(request: Request, work: () => Promise<unknown>) {
  try {
    const denied = localAccessError(request.headers, request.method);
    if (denied) throw new AppError(403, "local_only", denied);
    const result = await work();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: { code: "invalid_input", message: error.issues[0]?.message ?? "Invalid input." } }, { status: 400 });
    console.error("Raspberry request failed", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: { code: "internal_error", message: "Something went wrong. Your draft has been kept." } }, { status: 500 });
  }
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
