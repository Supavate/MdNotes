export async function request<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload &&
      typeof payload.error === "string"
      ? payload.error
      : "Something went wrong.";
    throw new Error(message);
  }
  return payload as T;
}
