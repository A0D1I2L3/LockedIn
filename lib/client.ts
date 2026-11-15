export async function api<T>(path: string, options: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = options;
  const init: RequestInit = { ...rest, headers: { ...(options.headers || {}) } };
  if (body !== undefined && typeof body !== "string") {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  } else if (typeof body === "string") {
    init.body = body;
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}
