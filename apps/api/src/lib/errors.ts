import { ERROR_MESSAGES, type ErrorCode } from '@kacp/shared';

/** Thrown from handlers; the error handler turns it into the 04-api.md §1 envelope. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    readonly details?: Record<string, unknown>,
    message?: string,
  ) {
    super(message ?? ERROR_MESSAGES[code]);
  }
}

export const notFound = (code: ErrorCode = 'NOT_FOUND') => new ApiError(404, code);
export const forbidden = () => new ApiError(403, 'FORBIDDEN');
