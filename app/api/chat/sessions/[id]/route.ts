import { NextRequest, NextResponse } from 'next/server';
import { defaultChatService } from '@/backend/services';
import { createApiSuccessResponse, createApiErrorResponse } from '@/lib/validation';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await defaultChatService.getSession(params.id);
    if (!session) {
      return NextResponse.json(
        createApiErrorResponse('NOT_FOUND', `Session '${params.id}' not found.`),
        { status: 404 }
      );
    }

    return NextResponse.json(createApiSuccessResponse(session));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = await defaultChatService.deleteSession(params.id);
    if (!deleted) {
      return NextResponse.json(
        createApiErrorResponse('NOT_FOUND', `Session '${params.id}' not found or already deleted.`),
        { status: 404 }
      );
    }

    return NextResponse.json(createApiSuccessResponse({ id: params.id }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
