import { chatService } from '../../../../../backend/services/chat-service.ts';
import { createApiSuccessResponse, createApiErrorResponse } from '../../../../../lib/validation.ts';

const SAFE_SESSION_ID_PATTERN = /^[a-zA-Z0-9_\-:.]{3,128}$/;

function validateSessionParamId(id: string): boolean {
  return typeof id === 'string' && SAFE_SESSION_ID_PATTERN.test(id.trim());
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const sessionId = params?.id?.trim();
  if (!sessionId || !validateSessionParamId(sessionId)) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', 'Invalid session ID parameter.'),
      { status: 400 }
    );
  }

  try {
    const session = await chatService.getSession(sessionId);
    if (!session) {
      return Response.json(
        createApiErrorResponse('NOT_FOUND', `Session '${sessionId}' not found.`),
        { status: 404 }
      );
    }

    return Response.json(createApiSuccessResponse(session));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const sessionId = params?.id?.trim();
  if (!sessionId || !validateSessionParamId(sessionId)) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', 'Invalid session ID parameter.'),
      { status: 400 }
    );
  }

  try {
    let body: { action?: string } = {};
    try {
      body = (await req.json()) as { action?: string };
    } catch {
      // empty body
    }

    if (body.action === 'clear') {
      const clearedSession = await chatService.clearSession(sessionId);
      if (!clearedSession) {
        return Response.json(
          createApiErrorResponse('NOT_FOUND', `Session '${sessionId}' not found.`),
          { status: 404 }
        );
      }
      return Response.json(createApiSuccessResponse(clearedSession));
    }

    return Response.json(
      createApiErrorResponse('BAD_REQUEST', "Unsupported action. Use { action: 'clear' } to clear session messages."),
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const sessionId = params?.id?.trim();
  if (!sessionId || !validateSessionParamId(sessionId)) {
    return Response.json(
      createApiErrorResponse('VALIDATION_ERROR', 'Invalid session ID parameter.'),
      { status: 400 }
    );
  }

  try {
    const deleted = await chatService.deleteSession(sessionId);
    if (!deleted) {
      return Response.json(
        createApiErrorResponse('NOT_FOUND', `Session '${sessionId}' not found or already deleted.`),
        { status: 404 }
      );
    }

    return Response.json(createApiSuccessResponse({ id: sessionId }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
