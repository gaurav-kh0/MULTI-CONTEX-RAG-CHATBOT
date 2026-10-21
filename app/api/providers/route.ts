import { providerRegistry } from '../../../backend/providers/index.ts';
import { DEFAULT_ALLOWED_MODELS } from '../../../backend/services/chat-service.ts';
import { createApiSuccessResponse } from '../../../lib/validation.ts';
import type { ProviderId, ProviderInfo, ProvidersResponsePayload } from '../../../lib/types.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supportedIds: ProviderId[] = ['gemini', 'openrouter', 'nvidia', 'mock'];
  const defaultProviderId = (process.env.DEFAULT_LLM_PROVIDER as ProviderId) || 'gemini';
  const defaultModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

  const providers: ProviderInfo[] = supportedIds.map((id) => {
    let isConfigured = false;
    let defaultModelName = '';
    let displayName: string = id;

    try {
      const adapter = providerRegistry.getProvider(id);
      isConfigured = adapter.isConfigured();
      defaultModelName = adapter.defaultModel;
      displayName = adapter.name;
    } catch {
      // Unconfigured or failed initialization
      isConfigured = false;
      displayName =
        id === 'gemini'
          ? 'Google Gemini'
          : id === 'openrouter'
          ? 'OpenRouter'
          : id === 'nvidia'
          ? 'NVIDIA NIM'
          : 'Mock Provider';
      defaultModelName =
        id === 'gemini'
          ? 'gemini-3.5-flash'
          : id === 'openrouter'
          ? 'meta-llama/llama-3.3-70b-instruct'
          : id === 'nvidia'
          ? 'meta/llama-3.3-70b-instruct'
          : 'mock-default-model';
    }

    const models = DEFAULT_ALLOWED_MODELS[id] || (defaultModelName ? [defaultModelName] : []);

    return {
      id,
      name: displayName,
      isConfigured,
      defaultModel: defaultModelName,
      models,
    };
  });

  const payload: ProvidersResponsePayload = {
    defaultProviderId,
    defaultModel,
    providers,
  };

  return Response.json(createApiSuccessResponse(payload));
}
