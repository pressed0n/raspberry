export class RequestError extends Error { constructor(public code: string, message: string, public status: number) { super(message); } }
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new RequestError(result.error?.code ?? "request_failed", result.error?.message ?? "Unable to save. Your draft is kept on this device.", response.status);
  return result;
}
export function download(name: string, content: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const element = document.createElement("a"); element.href = url; element.download = name; element.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
