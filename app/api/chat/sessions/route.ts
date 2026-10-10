import { NextRequest, NextResponse } from 'next/server';
import { defaultChatService } from '@/backend/services';
import { createApiSuccessResponse, createApiErrorResponse } from '@/lib/validation';

export async function GET() {
  try {
    const sessions = await defaultChatService.listSessions();
    return NextResponse.json(createApiSuccessResponse(sessions));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let title = 'New Chat';
    try {
      const body = await req.json();
      if (body?.title && typeof body.title === 'string' && body.title.trim()) {
        title = body.title.trim();
      }
    } catch {
      // Body is optional when creating a new session
    }

    const session = await defaultChatService.createSession(title);
    return NextResponse.json(createApiSuccessResponse(session), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
