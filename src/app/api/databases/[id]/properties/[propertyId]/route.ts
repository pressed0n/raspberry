import { z } from "zod";
import { api, pageId, readBody } from "@/server/http";
import { getDatabases } from "@/server/runtime";
import { primaryPropertyId } from "@/lib/database/types";
type Context = { params: Promise<{ id: string; propertyId: string }> };
export const runtime = "nodejs";
const deleteQuery = z.object({ mutationId: z.string().min(8).max(200) });
/* The primary property is addressed by its reserved id, not by a UUID: it has no row
   in `database_properties` because its values are `pages.title`. Validating every
   property id as a UUID would make the one column every database has the one column
   that cannot be renamed. */
const propertyKey = (value: string): string => (value === primaryPropertyId ? value : pageId(value));
export async function PATCH(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, propertyId } = await context.params;
    return { database: await (await getDatabases()).patchProperty(actor, pageId(id), propertyKey(propertyId), await readBody(request)) };
  });
}
/* Rename and configure go through PATCH; only removal lives here. It needs the
   mutation id too, or a retried delete would not be recognisable as a retry. */
export async function DELETE(request: Request, context: Context) {
  return api(request, async ({ actor }) => {
    const { id, propertyId } = await context.params;
    const { mutationId } = deleteQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return { database: await (await getDatabases()).deleteProperty(actor, pageId(id), propertyKey(propertyId), mutationId) };
  });
}
