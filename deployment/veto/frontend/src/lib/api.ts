/**
 * API client — all fetch calls go through this.
 * Prepends NEXT_PUBLIC_API_URL and includes credentials for cookies.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:10000";

export async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include", // send cookies cross-origin
    headers: {
      ...(options?.headers || {}),
    },
  });
}

export { API_URL };
