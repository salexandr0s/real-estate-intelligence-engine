// ── API Response Envelope ────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// ── Error Codes ─────────────────────────────────────────────────────────────

export const API_ERROR_CODES = {
  VALIDATION_ERROR: 'validation_error',
  NOT_FOUND: 'not_found',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  CONFLICT: 'conflict',
  RATE_LIMITED: 'rate_limited',
  SOURCE_DISABLED: 'source_disabled',
  BAD_REQUEST: 'bad_request',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type ApiErrorCode = typeof API_ERROR_CODES[keyof typeof API_ERROR_CODES];
