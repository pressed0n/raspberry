import { api } from "@/server/http";
import { getService } from "@/server/runtime";
export const runtime = "nodejs";
/** Empties the trash. `GET` is not implemented: there is nothing to read here. */
export async function DELETE(request: Request) { return api(request, async ({ actor }) => await (await getService()).emptyTrash(actor)); }
