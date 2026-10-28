import { NextRequest, NextResponse } from "next/server";
import { localAccessError } from "./server/local-access";

export function proxy(request: NextRequest) {
  const error = localAccessError(request.headers, request.method);
  if (error) return NextResponse.json({ error: { code: "local_only", message: error } }, { status: 403 });
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
