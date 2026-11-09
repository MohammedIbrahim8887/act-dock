/**
 * API response utilities for Act Dock.
 */

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

export type apiResponse = ApiResponse;

/**
 * Standard API response envelope.
 */
export function apiResponse<T = unknown>(status: number, data: T): ApiResponse<T> {
  return {
    status,
    data,
  };
}

