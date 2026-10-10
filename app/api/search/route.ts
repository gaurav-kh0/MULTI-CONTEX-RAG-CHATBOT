/**
 * /api/search Route Handler (Next.js 14 App Router)
 *
 * Thin HTTP layer for context-partitioned RAG retrieval and search queries.
 * Validates search input, handles malformed JSON, delegates to SearchService,
 * and returns explicit documented not-ready responses for unimplemented vector retrieval.
 */

import { searchService } from '@/backend/services/search-service';
import {
  validateUserMessage,
  validateContextTypes,
  createApiSuccessResponse,
  createApiErrorResponse,
} from '@/lib/validation';

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

  // Validate query string
  const queryCheck = validateUserMessage(body.query, { maxLength: 1000 });
  if (!queryCheck.valid) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', queryCheck.error, [
        { field: 'query', message: queryCheck.error },
      ]),
      { status: 400 }
    );
  }

  // Validate contexts if provided
  let contexts = undefined;
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
  }

  // Validate optional topK
  let topK = undefined;
  if (body.topK !== undefined) {
    if (typeof body.topK !== 'number' || !Number.isInteger(body.topK) || body.topK < 1 || body.topK > 50) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', 'topK must be an integer between 1 and 50.', [
          { field: 'topK', message: 'topK must be an integer between 1 and 50.' },
        ]),
        { status: 400 }
      );
    }
    topK = body.topK;
  }

  try {
    const result = await searchService.executeSearch({
      query: queryCheck.value,
      contexts,
      topK,
    });

    return Response.json(createApiSuccessResponse(result), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  const queryCheck = validateUserMessage(q, { maxLength: 1000 });
  if (!queryCheck.valid) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', queryCheck.error, [
        { field: 'q', message: queryCheck.error },
      ]),
      { status: 400 }
    );
  }

  const rawContexts = searchParams.get('contexts');
  let contexts = undefined;
  if (rawContexts) {
    const split = rawContexts.split(',').map((c) => c.trim());
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
  }

  try {
    const result = await searchService.executeSearch({
      query: queryCheck.value,
      contexts,
    });

    return Response.json(createApiSuccessResponse(result), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
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
