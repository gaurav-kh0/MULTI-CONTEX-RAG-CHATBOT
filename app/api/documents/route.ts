/**
 * /api/documents Route Handler (Next.js 14 App Router)
 *
 * Thin HTTP layer for document management and multipart PDF uploads.
 *
 * Features:
 * - Accepts PDF uploads through multipart/form-data.
 * - Enforces file-size limits, extension checks, MIME validation, and PDF signature verification.
 * - Rejects malformed or unsupported files with descriptive error codes.
 * - Delegates validation, disk storage, and metadata management to DocumentService.
 * - Preserves backward compatibility for JSON metadata registrations.
 */

import { documentService } from '../../../backend/services/document-service.ts';
import { DocumentProcessorError } from '../../../backend/rag/document-processor.ts';
import { EmbeddingError } from '../../../backend/rag/embeddings.ts';
import { PineconeStorageError } from '../../../backend/storage/pinecone.ts';
import {
  parseContextType,
  createApiSuccessResponse,
  createApiErrorResponse,
} from '../../../lib/validation.ts';

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
  const contentType = request.headers.get('content-type') || '';

  // ---------------------------------------------------------------------------
  // 1. Multipart FormData Upload Flow (PDF Uploads)
  // ---------------------------------------------------------------------------
  if (contentType.includes('multipart/form-data')) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return Response.json(
        createApiErrorResponse('BAD_REQUEST', 'Failed to parse multipart form data.'),
        { status: 400 }
      );
    }

    const file = formData.get('file');

    // Requirement: Validate file existence
    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      return Response.json(
        createApiErrorResponse(
          'VALIDATION_ERROR',
          'No file provided in upload request. Ensure the multipart field name is "file".',
          [{ field: 'file', message: 'File is required.' }]
        ),
        { status: 400 }
      );
    }

    // Validate Context Type
    const rawContext = formData.get('contextType') || formData.get('context');
    let contextType = parseContextType(rawContext);

    if (rawContext && !contextType) {
      return Response.json(
        createApiErrorResponse(
          'VALIDATION_ERROR',
          `Invalid contextType '${rawContext}'. Supported values: NEC, WATTMONK, GENERAL.`,
          [{ field: 'contextType', message: 'Supported: NEC, WATTMONK, GENERAL.' }]
        ),
        { status: 400 }
      );
    }

    // Default to GENERAL if context was omitted
    if (!contextType) {
      contextType = 'GENERAL';
    }

    const rawTitle = formData.get('title');
    const rawAuthor = formData.get('author');
    const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : undefined;
    const author = typeof rawAuthor === 'string' && rawAuthor.trim() ? rawAuthor.trim() : undefined;

    const rawAutoIndex = formData.get('autoIndex');
    const autoIndex = rawAutoIndex === 'false' ? false : true;

    try {
      // Read binary buffer from uploaded file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const result = await documentService.uploadDocument({
        buffer,
        filename: file.name || 'document.pdf',
        mimeType: file.type,
        contextType,
        title,
        author,
        autoIndex,
      });

      return Response.json(createApiSuccessResponse(result), { status: 201 });
    } catch (err: unknown) {
      if (err instanceof DocumentProcessorError) {
        const statusCode = err.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
        return Response.json(
          createApiErrorResponse(
            err.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR',
            err.message,
            err.details
              ? [
                  {
                    field: 'file',
                    message: String(err.details.message || err.message),
                  },
                ]
              : undefined
          ),
          { status: statusCode }
        );
      }

      if (err instanceof EmbeddingError) {
        const statusCode =
          err.code === 'RATE_LIMIT_ERROR'
            ? 429
            : err.code === 'CONFIGURATION_ERROR'
            ? 503
            : 500;
        return Response.json(
          createApiErrorResponse('SERVICE_UNAVAILABLE', err.message),
          { status: statusCode }
        );
      }

      if (err instanceof PineconeStorageError) {
        const statusCode =
          err.code === 'AUTHENTICATION_ERROR'
            ? 401
            : err.code === 'INDEX_NOT_FOUND'
            ? 404
            : err.code === 'RATE_LIMIT_ERROR'
            ? 429
            : err.code === 'CONFIGURATION_ERROR'
            ? 503
            : 500;
        return Response.json(
          createApiErrorResponse('SERVICE_UNAVAILABLE', err.message),
          { status: statusCode }
        );
      }

      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return Response.json(
        createApiErrorResponse('INTERNAL_ERROR', message),
        { status: 500 }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Application/JSON Registration Flow (Backwards Compatibility)
  // ---------------------------------------------------------------------------
  if (contentType.includes('application/json')) {
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

  // ---------------------------------------------------------------------------
  // 3. Unsupported Content-Type
  // ---------------------------------------------------------------------------
  return Response.json(
    createApiErrorResponse(
      'BAD_REQUEST',
      'Unsupported Content-Type. Please use multipart/form-data for file uploads or application/json for metadata registration.'
    ),
    { status: 400 }
  );
}

export async function PUT(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'PUT method is not supported on /api/documents. Use GET or POST.'),
    {
      status: 405,
      headers: { Allow: 'GET, POST' },
    }
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  let id = searchParams.get('id');

  if (!id) {
    try {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = (await request.json()) as { id?: string };
        if (body && typeof body.id === 'string') {
          id = body.id;
        }
      }
    } catch {
      // Body parsing ignored if not JSON
    }
  }

  if (!id || !id.trim()) {
    return Response.json(
      createApiErrorResponse(
        'VALIDATION_ERROR',
        'Document ID is required for deletion. Provide query param ?id=... or JSON body { "id": "..." }.'
      ),
      { status: 400 }
    );
  }

  try {
    const deleted = await documentService.deleteDocument(id.trim());
    if (!deleted) {
      return Response.json(
        createApiErrorResponse('NOT_FOUND', `Document '${id}' not found.`),
        { status: 404 }
      );
    }

    return Response.json(
      createApiSuccessResponse({
        id: id.trim(),
        deleted: true,
        message: `Document '${id}' deleted successfully.`,
      }),
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof PineconeStorageError) {
      return Response.json(
        createApiErrorResponse('SERVICE_UNAVAILABLE', err.message),
        { status: 503 }
      );
    }

    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
