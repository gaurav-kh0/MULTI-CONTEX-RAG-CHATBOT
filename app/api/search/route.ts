/**
 * /api/search Route Handler (Next.js 14 App Router)
 *
 * Server HTTP endpoint for semantic document search across partitioned knowledge scopes.
 * Reuses RagRetriever and embedding providers through SearchService.
 * Strictly avoids fake vectors, mock documents, or unhandled errors.
 */

import {
  searchService,
  SearchError,
  MIN_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
} from '../../../backend/services/search-service.ts';
import {
  validateUserMessage,
  validateContextType,
  validateContextTypes,
  validateDocumentId,
  validateRequestSize,
  createApiSuccessResponse,
  createApiErrorResponse,
} from '../../../lib/validation.ts';
import type { ContextType } from '../../../lib/types.ts';

function mapErrorToResponse(err: unknown): Response {
  if (err instanceof SearchError) {
    if (err.code === 'VALIDATION_ERROR') {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', err.message, [
          { message: err.message },
        ]),
        { status: 400 }
      );
    }
    if (
      err.code === 'CONFIGURATION_ERROR' ||
      err.code === 'STORAGE_ERROR' ||
      err.code === 'EMBEDDING_ERROR'
    ) {
      return Response.json(
        createApiErrorResponse('SERVICE_UNAVAILABLE', err.message, [
          { message: err.message },
        ]),
        { status: 503 }
      );
    }
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', err.message),
      { status: 500 }
    );
  }

  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return Response.json(
    createApiErrorResponse('INTERNAL_ERROR', message),
    { status: 500 }
  );
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      createApiErrorResponse('BAD_REQUEST', 'Malformed JSON in request body.'),
      { status: 400 }
    );
  }

  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return Response.json(
      createApiErrorResponse('BAD_REQUEST', 'Request body must be a JSON object.'),
      { status: 400 }
    );
  }

  const body = rawBody as Record<string, unknown>;

  // Check request size
  const sizeCheck = validateRequestSize(body);
  if (!sizeCheck.valid) {
    return Response.json(
      createApiErrorResponse('PAYLOAD_TOO_LARGE', sizeCheck.error, [
        { field: sizeCheck.field, message: sizeCheck.error },
      ]),
      { status: 413 }
    );
  }

  // Validate query string
  const queryCheck = validateUserMessage(body.query ?? body.q, { maxLength: 1000 });
  if (!queryCheck.valid) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', queryCheck.error, [
        { field: 'query', message: queryCheck.error },
      ]),
      { status: 400 }
    );
  }

  // Validate contexts if provided
  let contexts: ContextType[] | undefined = undefined;
  if (body.contexts !== undefined) {
    const contextsCheck = validateContextTypes(body.contexts, { allowEmpty: true });
    if (!contextsCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', contextsCheck.error, [
          { field: 'contexts', message: contextsCheck.error },
        ]),
        { status: 400 }
      );
    }
    contexts = contextsCheck.value;
  } else if (body.context !== undefined) {
    const contextCheck = validateContextType(body.context);
    if (!contextCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', contextCheck.error, [
          { field: 'context', message: contextCheck.error },
        ]),
        { status: 400 }
      );
    }
    contexts = [contextCheck.value];
  }

  // Validate optional documentId
  let documentId: string | undefined = undefined;
  if (body.documentId !== undefined && body.documentId !== null) {
    const docCheck = validateDocumentId(body.documentId);
    if (!docCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', docCheck.error, [
          { field: 'documentId', message: docCheck.error },
        ]),
        { status: 400 }
      );
    }
    documentId = docCheck.value;
  }

  // Validate optional limit / topK (1 to 50)
  let limit: number | undefined = undefined;
  const rawLimit = body.limit ?? body.topK;
  if (rawLimit !== undefined) {
    if (
      typeof rawLimit !== 'number' ||
      !Number.isInteger(rawLimit) ||
      rawLimit < MIN_SEARCH_LIMIT ||
      rawLimit > MAX_SEARCH_LIMIT
    ) {
      return Response.json(
        createApiErrorResponse(
          'VALIDATION_ERROR',
          `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}.`,
          [{ field: 'limit', message: `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}.` }]
        ),
        { status: 400 }
      );
    }
    limit = rawLimit;
  }

  // Validate optional minScoreThreshold
  let minScoreThreshold: number | undefined = undefined;
  if (body.minScoreThreshold !== undefined) {
    if (typeof body.minScoreThreshold !== 'number' || !Number.isFinite(body.minScoreThreshold)) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', 'minScoreThreshold must be a valid number.', [
          { field: 'minScoreThreshold', message: 'minScoreThreshold must be a valid number.' },
        ]),
        { status: 400 }
      );
    }
    minScoreThreshold = body.minScoreThreshold;
  }

  try {
    const result = await searchService.executeSearch({
      query: queryCheck.value,
      contexts,
      documentId,
      limit,
      minScoreThreshold,
    });

    return Response.json(createApiSuccessResponse(result), { status: 200 });
  } catch (err: unknown) {
    return mapErrorToResponse(err);
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? searchParams.get('query');

  const queryCheck = validateUserMessage(q, { maxLength: 1000 });
  if (!queryCheck.valid) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', queryCheck.error, [
        { field: 'q', message: queryCheck.error },
      ]),
      { status: 400 }
    );
  }

  // Contexts from query param
  let contexts: ContextType[] | undefined = undefined;
  const rawContexts = searchParams.get('contexts');
  const singleContext = searchParams.get('context');
  if (rawContexts) {
    const split = rawContexts.split(',').map((c) => c.trim()).filter(Boolean);
    const contextsCheck = validateContextTypes(split, { allowEmpty: true });
    if (!contextsCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', contextsCheck.error, [
          { field: 'contexts', message: contextsCheck.error },
        ]),
        { status: 400 }
      );
    }
    contexts = contextsCheck.value;
  } else if (singleContext) {
    const contextCheck = validateContextType(singleContext);
    if (!contextCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', contextCheck.error, [
          { field: 'context', message: contextCheck.error },
        ]),
        { status: 400 }
      );
    }
    contexts = [contextCheck.value];
  }

  // DocumentId
  let documentId: string | undefined = undefined;
  const rawDocId = searchParams.get('documentId') ?? searchParams.get('docId');
  if (rawDocId) {
    const docCheck = validateDocumentId(rawDocId);
    if (!docCheck.valid) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', docCheck.error, [
          { field: 'documentId', message: docCheck.error },
        ]),
        { status: 400 }
      );
    }
    documentId = docCheck.value;
  }

  // Limit / topK
  let limit: number | undefined = undefined;
  const rawLimit = searchParams.get('limit') ?? searchParams.get('topK');
  if (rawLimit) {
    const parsed = parseInt(rawLimit, 10);
    if (isNaN(parsed) || parsed < MIN_SEARCH_LIMIT || parsed > MAX_SEARCH_LIMIT) {
      return Response.json(
        createApiErrorResponse(
          'VALIDATION_ERROR',
          `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}.`,
          [{ field: 'limit', message: `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}.` }]
        ),
        { status: 400 }
      );
    }
    limit = parsed;
  }

  // MinScoreThreshold
  let minScoreThreshold: number | undefined = undefined;
  const rawThreshold = searchParams.get('minScoreThreshold') ?? searchParams.get('threshold');
  if (rawThreshold) {
    const parsed = parseFloat(rawThreshold);
    if (isNaN(parsed) || !Number.isFinite(parsed)) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', 'minScoreThreshold must be a valid number.', [
          { field: 'minScoreThreshold', message: 'minScoreThreshold must be a valid number.' },
        ]),
        { status: 400 }
      );
    }
    minScoreThreshold = parsed;
  }

  try {
    const result = await searchService.executeSearch({
      query: queryCheck.value,
      contexts,
      documentId,
      limit,
      minScoreThreshold,
    });

    return Response.json(createApiSuccessResponse(result), { status: 200 });
  } catch (err: unknown) {
    return mapErrorToResponse(err);
  }
}

// Handle unsupported HTTP methods
export async function PUT(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'PUT method is not supported on /api/search. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}

export async function DELETE(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'DELETE method is not supported on /api/search. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}

export async function PATCH(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'PATCH method is not supported on /api/search. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}
