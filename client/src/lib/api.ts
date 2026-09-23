// Gateway base URL for HTTP and WebSocket; the ws:// URL is derived from it.
export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001"
