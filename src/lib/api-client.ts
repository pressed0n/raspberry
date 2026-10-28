export class RequestError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); this.name = "RequestError"; }
}
type Envelope = { error?: { code?: string; message?: string } };
const unreachable = "Unable to reach Raspberry. Your draft is kept on this device.";
function parse(text: string): Envelope | null {
  if (!text) return null;
  try { return JSON.parse(text) as Envelope; } catch { return null; }
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
  // A crash page, a proxy error, or an empty body is not JSON. Parsing blindly
  // threw a SyntaxError that bypassed both the message and the 409 conflict path.
  const result = parse(await response.text());
  if (!response.ok) throw new RequestError(result?.error?.code ?? "request_failed", result?.error?.message ?? unreachable, response.status);
  if (result === null) throw new RequestError("invalid_response", unreachable, response.status);
  return result as unknown as T;
}
export function download(name: string, content: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const element = document.createElement("a"); element.href = url; element.download = name; element.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
