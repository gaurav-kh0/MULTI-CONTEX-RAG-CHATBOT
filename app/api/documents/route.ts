/**
 * /api/documents Route Handler (Next.js 14 App Router)
 *
 * Thin HTTP layer for listing and registering documents.
 * Validates query parameters and body payloads, handles malformed JSON,
 * and delegates processing to DocumentService.
 */

import { documentService } from '@/backend/services/document-service';
import {
  parseContextType,
  createApiSuccessResponse,
  createApiErrorResponse,
} from '@/lib/validation';

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const rawContext = searchParams.get('contextType');

  let contextType = undefined;
  if (rawContext) {
    const parsed = parseContextType(rawContext);
    if (!parsed) {
      return Response.json(
        createApiErrorResponse(
          'VALIDATION_ERROR',
          `Invalid contextType query parameter. Must be one of: NEC, WATTMONK, GENERAL.`
        ),
        { status: 400 }
      );
    }
    contextType = parsed;
  }

  try {
    const documents = await documentService.listDocuments(contextType);
    return Response.json(createApiSuccessResponse(documents), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
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

  // Validate title
  if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', 'Document title is required.', [
        { field: 'title', message: 'Document title cannot be empty.' },
      ]),
      { status: 400 }
    );
  }

  // Validate contextType
  const parsedContext = parseContextType(body.contextType);
  if (!parsedContext) {
    return Response.json(
      createApiErrorResponse(
        'VALIDATION_ERROR',
        'Invalid or missing contextType. Must be one of: NEC, WATTMONK, GENERAL.',
        [{ field: 'contextType', message: 'Supported: NEC, WATTMONK, GENERAL.' }]
      ),
      { status: 400 }
    );
  }

  try {
    const result = await documentService.registerDocument({
      title: body.title.trim(),
      contextType: parsedContext,
      content: typeof body.content === 'string' ? body.content.trim() : undefined,
      sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : undefined,
      author: typeof body.author === 'string' ? body.author.trim() : undefined,
    });

    return Response.json(createApiSuccessResponse(result), { status: 201 });
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
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'PUT method is not supported on /api/documents. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}

export async function DELETE(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'DELETE method is not supported on /api/documents. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}
