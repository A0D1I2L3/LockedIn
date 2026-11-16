export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function api<T>(path: string, options: Omit<RequestInit, "body"> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = options;
  const init: RequestInit = { ...rest, headers: { ...(options.headers || {}) } };
  if (body !== undefined && typeof body !== "string") {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  } else if (typeof body === "string") {
    init.body = body;
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiClientError(0, "Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string; code?: string };
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/status")) {
      window.location.assign("/");
    }
    throw new ApiClientError(
      response.status,
      data.detail || `${response.status} ${response.statusText}`,
      data.code,
    );
  }
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}
