import { SignInPanel } from "@/components/sign-in";

export const dynamic = "force-dynamic";

// `searchParams` is a Promise in this version of Next; the panel takes plain values.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const params = await searchParams;
  return <SignInPanel error={params.error} next={params.next} />;
}
