import { chatService } from '../../../../backend/services/chat-service.ts';
import { createApiSuccessResponse, createApiErrorResponse } from '../../../../lib/validation.ts';

export async function GET(): Promise<Response> {
  try {
    const sessions = await chatService.listSessions();
    return Response.json(createApiSuccessResponse(sessions));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    let title = 'New Chat';
    try {
      const body = await req.json();
      if (body?.title && typeof body.title === 'string' && body.title.trim()) {
        title = body.title.trim().slice(0, 100);
      }
    } catch {
      // Body is optional when creating a new session
    }

    const session = await chatService.createSession(title);
    return Response.json(createApiSuccessResponse(session), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
