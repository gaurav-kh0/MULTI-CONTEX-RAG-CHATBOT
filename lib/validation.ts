/**
 * Server-Side Validation Helpers
 *
 * Implements native TypeScript/JavaScript validation for incoming requests,
 * context values, provider IDs, document IDs, and request size limits.
 * Avoids heavy third-party dependencies while providing strict type safety.
 */

import type {
  ApiErrorCode,
  ApiErrorDetail,
  ApiErrorResponse,
  ApiSuccessResponse,
  ChatRequest,
  ContextType,
  ProviderId,
} from './types.ts';

import {
  CONTEXT_TYPES,
  PROVIDER_IDS,
} from './types.ts';

// ---------------------------------------------------------------------------
// 1. User Message Validation
// ---------------------------------------------------------------------------

export interface ValidationSuccess<T> {
  valid: true;
  value: T;
}

export interface ValidationFailure {
  valid: false;
  error: string;
  field?: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface MessageValidationOptions {
  minLength?: number;
  maxLength?: number;
}

const DEFAULT_MESSAGE_MIN_LENGTH = 1;
const DEFAULT_MESSAGE_MAX_LENGTH = 4000;

export function validateUserMessage(
  input: unknown,
  options?: MessageValidationOptions
): ValidationResult<string> {
  const minLength = options?.minLength ?? DEFAULT_MESSAGE_MIN_LENGTH;
  const maxLength = options?.maxLength ?? DEFAULT_MESSAGE_MAX_LENGTH;

  if (typeof input !== 'string') {
    return {
      valid: false,
      field: 'message',
      error: 'Message must be a string.',
    };
  }

  const trimmed = input.trim();

  if (trimmed.length < minLength) {
    return {
      valid: false,
      field: 'message',
      error: `Message cannot be empty (minimum ${minLength} characters required).`,
    };
  }

  if (trimmed.length > maxLength) {
    return {
      valid: false,
      field: 'message',
      error: `Message exceeds maximum allowed length of ${maxLength} characters (received ${trimmed.length}).`,
    };
  }

  return { valid: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// 2. Context Values Validation
// ---------------------------------------------------------------------------

export function isContextType(value: unknown): value is ContextType {
  return typeof value === 'string' && (CONTEXT_TYPES as readonly string[]).includes(value);
}

export function parseContextType(value: unknown): ContextType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === 'NEC' || normalized === 'SCOPE_NEC') return 'NEC';
  if (normalized === 'WATTMONK' || normalized === 'SOLAR' || normalized === 'SCOPE_SOLAR') {
    return 'WATTMONK';
  }
  if (normalized === 'GENERAL' || normalized === 'SCOPE_GENERAL') return 'GENERAL';
  return null;
}

export function validateContextType(value: unknown): ValidationResult<ContextType> {
  const parsed = parseContextType(value);
  if (!parsed) {
    return {
      valid: false,
      field: 'context',
      error: `Invalid context type. Must be one of: ${CONTEXT_TYPES.join(', ')}.`,
    };
  }
  return { valid: true, value: parsed };
}

export function validateContextTypes(
  input: unknown,
  options?: { allowEmpty?: boolean }
): ValidationResult<ContextType[]> {
  const allowEmpty = options?.allowEmpty ?? false;

  if (!Array.isArray(input)) {
    return {
      valid: false,
      field: 'contexts',
      error: 'Contexts must be an array of ContextType values.',
    };
  }

  if (!allowEmpty && input.length === 0) {
    return {
      valid: false,
      field: 'contexts',
      error: 'At least one context type must be provided.',
    };
  }

  const validated: ContextType[] = [];
  const invalidItems: string[] = [];

  for (const item of input) {
    const parsed = parseContextType(item);
    if (parsed) {
      if (!validated.includes(parsed)) {
        validated.push(parsed);
      }
    } else {
      invalidItems.push(String(item));
    }
  }

  if (invalidItems.length > 0) {
    return {
      valid: false,
      field: 'contexts',
      error: `Invalid context values: [${invalidItems.join(', ')}]. Supported: ${CONTEXT_TYPES.join(', ')}.`,
    };
  }

  return { valid: true, value: validated };
}

// ---------------------------------------------------------------------------
// 3. Provider ID Validation
// ---------------------------------------------------------------------------

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function validateProviderId(value: unknown): ValidationResult<ProviderId> {
  if (typeof value !== 'string' || !isProviderId(value)) {
    return {
      valid: false,
      field: 'providerId',
      error: `Invalid provider ID. Must be one of: ${PROVIDER_IDS.join(', ')}.`,
    };
  }
  return { valid: true, value };
}

// ---------------------------------------------------------------------------
// 4. Document ID Validation
// ---------------------------------------------------------------------------

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-\.:]{3,128}$/;

export function validateDocumentId(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return {
      valid: false,
      field: 'documentId',
      error: 'Document ID must be a string.',
    };
  }

  const trimmed = input.trim();

  if (!SAFE_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      field: 'documentId',
      error:
        'Document ID must be 3-128 characters containing only alphanumeric characters, underscores, hyphens, colons, or periods.',
    };
  }

  return { valid: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// 5. Request Size Validation
// ---------------------------------------------------------------------------

const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024; // 64 KB

export function validateRequestSize(
  input: unknown,
  maxBytes: number = DEFAULT_MAX_REQUEST_BYTES
): ValidationResult<number> {
  try {
    let sizeInBytes = 0;
    if (typeof input === 'string') {
      sizeInBytes = Buffer.byteLength(input, 'utf8');
    } else if (input !== null && typeof input === 'object') {
      sizeInBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    } else {
      sizeInBytes = 0;
    }

    if (sizeInBytes > maxBytes) {
      return {
        valid: false,
        field: 'body',
        error: `Payload size (${sizeInBytes} bytes) exceeds maximum limit of ${maxBytes} bytes.`,
      };
    }

    return { valid: true, value: sizeInBytes };
  } catch {
    return {
      valid: false,
      field: 'body',
      error: 'Unable to calculate request payload size.',
    };
  }
}

// ---------------------------------------------------------------------------
// 6. Comprehensive ChatRequest Validator
// ---------------------------------------------------------------------------

export interface ValidatedChatRequestResult {
  valid: true;
  data: ChatRequest;
}

export interface FailedChatRequestResult {
  valid: false;
  error: string;
  code: ApiErrorCode;
  details: ApiErrorDetail[];
}

export function validateChatRequest(
  body: unknown
): ValidatedChatRequestResult | FailedChatRequestResult {
  const details: ApiErrorDetail[] = [];

  // 1. Verify object shape
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      code: 'BAD_REQUEST',
      error: 'Request body must be a JSON object.',
      details: [{ message: 'Expected JSON object for ChatRequest.' }],
    };
  }

  const raw = body as Record<string, unknown>;

  // 2. Validate request size
  const sizeCheck = validateRequestSize(raw);
  if (!sizeCheck.valid) {
    return {
      valid: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: sizeCheck.error,
      details: [{ field: sizeCheck.field, message: sizeCheck.error }],
    };
  }

  // 3. Validate user message
  const messageCheck = validateUserMessage(raw.message);
  if (!messageCheck.valid) {
    details.push({ field: messageCheck.field, message: messageCheck.error });
  }

  // 4. Validate context types (supports both `contexts` and legacy `activeContextScopeIds`)
  let resolvedContexts: ContextType[] = [];
  const rawContexts = raw.contexts ?? raw.activeContextScopeIds;

  if (rawContexts !== undefined) {
    const contextsCheck = validateContextTypes(rawContexts, { allowEmpty: true });
    if (!contextsCheck.valid) {
      details.push({ field: contextsCheck.field, message: contextsCheck.error });
    } else {
      resolvedContexts = contextsCheck.value;
    }
  }

  // 5. Validate optional providerId
  let resolvedProviderId: ProviderId | undefined;
  if (raw.providerId !== undefined) {
    const providerCheck = validateProviderId(raw.providerId);
    if (!providerCheck.valid) {
      details.push({ field: providerCheck.field, message: providerCheck.error });
    } else {
      resolvedProviderId = providerCheck.value;
    }
  }

  // 6. Validate optional topK
  let resolvedTopK: number | undefined;
  if (raw.topK !== undefined) {
    if (typeof raw.topK !== 'number' || !Number.isInteger(raw.topK) || raw.topK < 1 || raw.topK > 50) {
      details.push({
        field: 'topK',
        message: 'topK must be an integer between 1 and 50.',
      });
    } else {
      resolvedTopK = raw.topK;
    }
  }

  // 7. Validate optional sessionId
  let resolvedSessionId: string | undefined;
  if (raw.sessionId !== undefined) {
    if (typeof raw.sessionId !== 'string' || raw.sessionId.trim().length === 0) {
      details.push({
        field: 'sessionId',
        message: 'sessionId must be a non-empty string.',
      });
    } else {
      resolvedSessionId = raw.sessionId.trim();
    }
  }

  if (details.length > 0) {
    return {
      valid: false,
      code: 'VALIDATION_ERROR',
      error: details[0].message,
      details,
    };
  }

  return {
    valid: true,
    data: {
      message: (messageCheck as ValidationSuccess<string>).value,
      contexts: resolvedContexts,
      sessionId: resolvedSessionId,
      providerId: resolvedProviderId,
      topK: resolvedTopK,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. API Response Constructors
// ---------------------------------------------------------------------------

export function createApiSuccessResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

export function createApiErrorResponse(
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetail[]
): ApiErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  };
}
