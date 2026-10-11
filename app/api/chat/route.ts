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
import { ProviderError } from '@/backend/providers';
import { formatSseEvent, type ChatStreamErrorData } from '@/lib/stream-protocol';

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

  // 3. Check for streaming request
  const isStreamingRequested =
    validation.data.stream === true ||
    request.headers.get('accept')?.includes('text/event-stream');

  if (isStreamingRequested) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of chatService.streamMessage(validation.data, {
            signal: request.signal,
          })) {
            const wireEvent = formatSseEvent(event);
            controller.enqueue(encoder.encode(wireEvent));
          }
          controller.close();
        } catch (err: unknown) {
          const errPayload: ChatStreamErrorData = {
            code: err instanceof ProviderError ? err.code : 'INTERNAL_ERROR',
            message:
              err instanceof Error
                ? err.message
                : 'An unexpected error occurred during streaming.',
          };
          try {
            controller.enqueue(
              encoder.encode(formatSseEvent({ type: 'error', data: errPayload }))
            );
            controller.close();
          } catch {
            // Controller might already be closed or errored
          }
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // 4. Delegate to non-streaming ChatService
  try {
    const result = await chatService.processMessage(validation.data);
    return Response.json(createApiSuccessResponse(result), { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ProviderError) {
      let status = 500;
      let apiCode: 'BAD_REQUEST' | 'NOT_FOUND' | 'SERVICE_UNAVAILABLE' | 'INTERNAL_ERROR' = 'INTERNAL_ERROR';

      switch (err.code) {
        case 'INVALID_REQUEST':
          status = 400;
          apiCode = 'BAD_REQUEST';
          break;
        case 'MODEL_NOT_FOUND':
          status = 400;
          apiCode = 'NOT_FOUND';
          break;
        case 'RATE_LIMIT_ERROR':
          status = 429;
          apiCode = 'SERVICE_UNAVAILABLE';
          break;
        case 'CONFIGURATION_ERROR':
          status = 503;
          apiCode = 'SERVICE_UNAVAILABLE';
          break;
        case 'AUTHENTICATION_ERROR':
        case 'PERMISSION_DENIED':
        case 'PROVIDER_DOWN':
          status = 502;
          apiCode = 'SERVICE_UNAVAILABLE';
          break;
        case 'NETWORK_ERROR':
          status = 504;
          apiCode = 'SERVICE_UNAVAILABLE';
          break;
        default:
          status = err.statusCode || 500;
          apiCode = 'INTERNAL_ERROR';
      }

      return Response.json(
        createApiErrorResponse(apiCode, err.message),
        { status }
      );
    }

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
