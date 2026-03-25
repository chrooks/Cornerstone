/**
 * API client utility for communicating with the Flask backend.
 * All fetch calls to the backend should go through here to keep
 * base URL and error handling in one place.
 */

// Points to the Flask dev server by default; override via env var in production.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";

/**
 * Generic fetch wrapper that prepends the backend base URL.
 * Throws on non-2xx responses with a descriptive error message.
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status} on ${path}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/** Check backend health — used on the homepage to confirm connectivity. */
export async function checkHealth(): Promise<{ status: string; message: string }> {
  return apiFetch("/api/health");
}
