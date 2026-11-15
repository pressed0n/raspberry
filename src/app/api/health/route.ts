import { NextResponse } from "next/server";
import { accessMode } from "@/server/access";
import { getService } from "@/server/runtime";
import { storageConfigured } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness for the machine that will host Raspberry (systemd, Task Scheduler,
 * an external uptime monitor). It is exempt from the access guard, so it must
 * never describe the workspace: local mode additionally proves the database is
 * readable, hosted mode reports liveness and the storage backend only.
 *
 * `storage` is there because a hosted deployment with no bucket accepts no uploads,
 * and that is invisible from the outside until someone's photo fails. It is a fact
 * about configuration, not about anyone's notes, so it is safe to publish — and it is
 * how the deployment was verified.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (accessMode() !== "local") {
    return NextResponse.json({ status: "ok", storage: storageConfigured() ? "s3" : "none" }, { headers });
  }
  try {
    const healthy = await (await getService()).ping();
    return NextResponse.json(
      { status: healthy ? "ok" : "degraded", database: healthy, storage: storageConfigured() ? "s3" : "disk" },
      { status: healthy ? 200 : 503, headers },
    );
  } catch {
    return NextResponse.json({ status: "degraded", database: false }, { status: 503, headers });
  }
}
