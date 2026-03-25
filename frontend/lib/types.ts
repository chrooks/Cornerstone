/**
 * Shared TypeScript types used across the frontend.
 * Domain-specific types will be added here as features are built.
 */

/** Standard API response envelope from the Flask backend. */
export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

/** Health check response from GET /api/health */
export interface HealthResponse {
  status: string;
  message: string;
}
