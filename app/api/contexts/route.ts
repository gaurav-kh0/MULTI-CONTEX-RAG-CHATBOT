import { defaultContextService } from '../../../backend/services/index.ts';
import { createApiSuccessResponse, createApiErrorResponse } from '../../../lib/validation.ts';

export async function GET() {
  try {
    const scopes = await defaultContextService.listScopes();
    return Response.json(createApiSuccessResponse(scopes));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return Response.json(
        createApiErrorResponse('VALIDATION_ERROR', 'Context scope name is required and cannot be empty.', [
          { field: 'name', message: 'Context scope name is required.' },
        ]),
        { status: 400 }
      );
    }

    const newScope = await defaultContextService.createScope({
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description.trim() : undefined,
    });

    return Response.json(createApiSuccessResponse(newScope), { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return Response.json(
      createApiErrorResponse('INTERNAL_ERROR', message),
      { status: 500 }
    );
  }
}
