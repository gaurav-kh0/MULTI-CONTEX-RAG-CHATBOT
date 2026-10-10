/**
 * /api/chat Route Handler (Next.js 14 App Router)
 *
 * Thin HTTP layer for multi-context chat submissions.
 * Validates input, handles malformed JSON and unsupported methods,
 * and delegates processing to ChatService.
 */

import { chatService } from '@/backend/services/chat-service';
import {
  validateChatRequest,
  createApiSuccessResponse,
  createApiErrorResponse,
} from '@/lib/validation';

export async function POST(request: Request): Promise<Response> {
  // 1. Parse JSON with malformed body handling
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      createApiErrorResponse('BAD_REQUEST', 'Malformed JSON in request body.'),
      { status: 400 }
    );
  }

  // 2. Validate request payload against domain contracts
  const validation = validateChatRequest(rawBody);
  if (!validation.valid) {
    const status = validation.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    return Response.json(
      createApiErrorResponse(validation.code, validation.error, validation.details),
      { status }
    );
  }

  // 3. Delegate to server-only ChatService
  try {
    const result = await chatService.processMessage(validation.data);
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
export async function GET(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'GET method is not supported on /api/chat. Use POST.'),
    {
      status: 405,
      headers: { Allow: 'POST' },
    }
  );
}

export async function PUT(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'PUT method is not supported on /api/chat. Use POST.'),
    {
      status: 405,
      headers: { Allow: 'POST' },
    }
  );
}

export async function DELETE(): Promise<Response> {
  return Response.json(
    createApiErrorResponse('METHOD_NOT_ALLOWED', 'DELETE method is not supported on /api/chat. Use POST.'),
    {
      status: 405,
      headers: { Allow: 'POST' },
    }
  );
}
