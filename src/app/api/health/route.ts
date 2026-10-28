import { NextResponse } from "next/server";
import { accessMode } from "@/server/access";
import { getService } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness for the machine that will host Raspberry (systemd, Task Scheduler,
 * an external uptime monitor). It is exempt from the access guard, so it must
 * never describe the workspace: local mode additionally proves the database is
 * readable, hosted mode reports liveness only.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (accessMode() !== "local") return NextResponse.json({ status: "ok" }, { headers });
  try {
    const healthy = await (await getService()).ping();
    return NextResponse.json({ status: healthy ? "ok" : "degraded", database: healthy }, { status: healthy ? 200 : 503, headers });
  } catch {
    return NextResponse.json({ status: "degraded", database: false }, { status: 503, headers });
  }
}
