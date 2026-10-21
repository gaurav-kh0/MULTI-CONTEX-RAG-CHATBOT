/**
 * AI Provider Error Hierarchy
 *
 * Provides standardized, typed error structures across all AI LLM providers
 * (Gemini, OpenRouter, NVIDIA, Mock).
 *
 * Prevents ambiguous errors and ensures upstream callers receive explicit
 * status codes and diagnostic codes without silent fallbacks.
 */

import type { ProviderId, ApiErrorCode } from '../../lib/types.ts';

export type ProviderErrorCode =
  | 'CONFIGURATION_ERROR'   // Missing API key, empty endpoint, invalid provider config
  | 'AUTHENTICATION_ERROR'  // HTTP 401: Invalid API key or rejected auth
  | 'PERMISSION_DENIED'     // HTTP 403: Insufficient permissions or disallowed model
  | 'RATE_LIMIT_ERROR'      // HTTP 429: Quota exceeded or rate limited
  | 'MODEL_NOT_FOUND'       // HTTP 404: Specified model does not exist or isn't accessible
  | 'INVALID_REQUEST'       // HTTP 400: Malformed body, context window exceeded, bad params
  | 'NETWORK_ERROR'         // Connection dropped, DNS failure, timeout
  | 'PROVIDER_DOWN'         // HTTP 5xx: Upstream service failure
  | 'PARSE_ERROR';          // Malformed JSON response or broken SSE stream

export interface ProviderErrorOptions {
  providerId: ProviderId;
  code: ProviderErrorCode;
  message: string;
  statusCode?: number;
  rawError?: unknown;
}

export class ProviderError extends Error {
  readonly providerId: ProviderId;
  readonly code: ProviderErrorCode;
  readonly statusCode?: number;
  readonly rawError?: unknown;

  constructor(options: ProviderErrorOptions) {
    super(`[${options.providerId.toUpperCase()}] ${options.code}: ${options.message}`);
    this.name = 'ProviderError';
    this.providerId = options.providerId;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.rawError = options.rawError;

    // Maintain standard Error prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      providerId: this.providerId,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
  }
}

/**
 * Maps an HTTP status code returned by an external AI provider to a canonical ProviderErrorCode.
 */
export function mapHttpStatusToErrorCode(statusCode: number): ProviderErrorCode {
  switch (statusCode) {
    case 401:
      return 'AUTHENTICATION_ERROR';
    case 402:
      return 'RATE_LIMIT_ERROR'; // Insufficient credits / quota
    case 403:
      return 'PERMISSION_DENIED';
    case 404:
      return 'MODEL_NOT_FOUND';
    case 429:
      return 'RATE_LIMIT_ERROR';
    default:
      if (statusCode >= 400 && statusCode < 500) {
        return 'INVALID_REQUEST';
      }
      if (statusCode >= 500 && statusCode < 600) {
        return 'PROVIDER_DOWN';
      }
      return 'NETWORK_ERROR';
  }
}

/**
 * Strips raw secrets, API keys, and Bearer tokens from error strings to prevent leaking credentials.
 */
export function sanitizeErrorMessage(message: string, secrets: (string | undefined)[] = []): string {
  let sanitized = message;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      sanitized = sanitized.split(secret).join('[REDACTED_SECRET]');
    }
  }
  // Redact any Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9_\-\.]{8,}/gi, 'Bearer [REDACTED_KEY]');
  return sanitized;
}

/**
 * Maps a ProviderError to appropriate HTTP status and standard API error code.
 */
export function mapProviderErrorToHttpStatus(err: ProviderError): { status: number; apiCode: ApiErrorCode } {
  switch (err.code) {
    case 'INVALID_REQUEST':
      return { status: 400, apiCode: 'BAD_REQUEST' };
    case 'MODEL_NOT_FOUND':
      return { status: 400, apiCode: 'NOT_FOUND' };
    case 'RATE_LIMIT_ERROR':
      return { status: 429, apiCode: 'SERVICE_UNAVAILABLE' };
    case 'CONFIGURATION_ERROR':
      return { status: 503, apiCode: 'SERVICE_UNAVAILABLE' };
    case 'AUTHENTICATION_ERROR':
    case 'PERMISSION_DENIED':
    case 'PROVIDER_DOWN':
      return { status: 502, apiCode: 'SERVICE_UNAVAILABLE' };
    case 'NETWORK_ERROR':
      return { status: 504, apiCode: 'SERVICE_UNAVAILABLE' };
    default:
      return { status: err.statusCode || 500, apiCode: 'INTERNAL_ERROR' };
  }
}
