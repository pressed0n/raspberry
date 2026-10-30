import { redirect } from "next/navigation";

/* `/settings` was a route until B31; settings is now a dialog over the
   workspace. The route stays as a redirect rather than a 404 because the old URL
   is the kind of thing that ends up in a bookmark bar or a README, and a dead
   link is a worse answer than the thing it used to show. The workspace reads the
   `settings` parameter, opens the dialog and drops it from the address bar. */
export default function Page() {
  redirect("/?settings=1");
}
