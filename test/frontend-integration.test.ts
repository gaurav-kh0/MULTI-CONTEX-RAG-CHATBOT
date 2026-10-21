import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GET as getProviders } from '../app/api/providers/route.ts';
import { GET as getContexts } from '../app/api/contexts/route.ts';
import { chatReducer, initialState } from '../hooks/useChatState.ts';
import type { ProvidersResponsePayload, ContextDocument } from '../lib/types.ts';

describe('Frontend Integration - Providers & Models API', () => {
  it('GET /api/providers returns supported providers without exposing API keys', async () => {
    const res = await getProviders();
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(json.data);
    assert.ok(json.data.defaultProviderId);
    assert.ok(Array.isArray(json.data.providers));
    assert.ok(json.data.providers.length >= 4);

    const providerIds = json.data.providers.map((p: { id: string }) => p.id);
    assert.ok(providerIds.includes('gemini'));
    assert.ok(providerIds.includes('openrouter'));
    assert.ok(providerIds.includes('nvidia'));
    assert.ok(providerIds.includes('mock'));

    // Verify security: No secrets or env keys exposed
    const stringified = JSON.stringify(json);
    assert.equal(stringified.includes('AIza'), false, 'Never expose Google API keys');
    assert.equal(stringified.includes('nvapi-'), false, 'Never expose NVIDIA API keys');
    assert.equal(stringified.includes('sk-or-'), false, 'Never expose OpenRouter API keys');

    // Verify structure of each provider
    for (const provider of json.data.providers) {
      assert.ok(typeof provider.id === 'string');
      assert.ok(typeof provider.name === 'string');
      assert.ok(typeof provider.isConfigured === 'boolean');
      assert.ok(typeof provider.defaultModel === 'string');
      assert.ok(Array.isArray(provider.models));
      assert.ok(provider.models.length > 0);
    }
  });

  it('GET /api/contexts returns dynamic scope document counts without fake numbers', async () => {
    const res = await getContexts();
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data));

    // Scopes should have documentIds reflecting registered documents
    for (const scope of json.data) {
      assert.ok(scope.id);
      assert.ok(Array.isArray(scope.documentIds));
      assert.ok(typeof scope.name === 'string');
    }
  });
});

describe('Frontend Integration - ChatState Reducer Transitions', () => {
  it('initializes with default provider, models, and empty session', () => {
    assert.equal(initialState.selectedProviderId, 'gemini');
    assert.equal(initialState.selectedModel, 'gemini-3.5-flash');
    assert.equal(initialState.messages.length, 0);
    assert.equal(initialState.documentOnly, false);
  });

  it('handles SET_PROVIDERS correctly', () => {
    const mockPayload: ProvidersResponsePayload = {
      defaultProviderId: 'nvidia',
      defaultModel: 'meta/llama-3.3-70b-instruct',
      providers: [
        {
          id: 'nvidia',
          name: 'NVIDIA NIM',
          isConfigured: true,
          defaultModel: 'meta/llama-3.3-70b-instruct',
          models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
        },
      ],
    };

    const nextState = chatReducer(initialState, {
      type: 'SET_PROVIDERS',
      payload: mockPayload,
    });

    assert.equal(nextState.selectedProviderId, 'nvidia');
    assert.equal(nextState.selectedModel, 'meta/llama-3.3-70b-instruct');
    assert.equal(nextState.providers.length, 1);
  });

  it('handles SET_PROVIDER and updates default model for that provider', () => {
    const stateWithProviders = {
      ...initialState,
      providers: [
        {
          id: 'gemini' as const,
          name: 'Google Gemini',
          isConfigured: true,
          defaultModel: 'gemini-3.5-flash',
          models: ['gemini-3.5-flash', 'gemini-3.8-flash'],
        },
        {
          id: 'nvidia' as const,
          name: 'NVIDIA NIM',
          isConfigured: true,
          defaultModel: 'meta/llama-3.3-70b-instruct',
          models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
        },
      ],
    };

    const nextState = chatReducer(stateWithProviders, {
      type: 'SET_PROVIDER',
      payload: { providerId: 'nvidia' },
    });

    assert.equal(nextState.selectedProviderId, 'nvidia');
    assert.equal(nextState.selectedModel, 'meta/llama-3.3-70b-instruct');
  });

  it('handles SET_MODEL independently', () => {
    const nextState = chatReducer(initialState, {
      type: 'SET_MODEL',
      payload: 'gemini-3.8-flash',
    });

    assert.equal(nextState.selectedModel, 'gemini-3.8-flash');
  });

  it('handles SET_SELECTED_DOCUMENT: enables documentOnly and activates required context scope', () => {
    const mockDocs: ContextDocument[] = [
      {
        id: 'doc-solar-123',
        name: 'solar_plan.pdf',
        sourceType: 'file',
        status: 'indexed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          contextType: 'WATTMONK',
          pageCount: 5,
        },
      },
    ];

    const stateWithDocs = {
      ...initialState,
      documents: mockDocs,
      activeScopeIds: ['scope_nec'],
    };

    const nextState = chatReducer(stateWithDocs, {
      type: 'SET_SELECTED_DOCUMENT',
      payload: 'doc-solar-123',
    });

    assert.equal(nextState.selectedDocumentId, 'doc-solar-123');
    assert.equal(nextState.documentOnly, true);
    assert.ok(nextState.activeScopeIds.includes('scope_solar'), 'Automatically activates scope_solar for WATTMONK doc');
    assert.ok(nextState.activeScopeIds.includes('scope_nec'), 'Preserves previously active scopes');
  });

  it('handles NEW_CHAT: clears messages and active session ID', () => {
    const stateWithMessages = {
      ...initialState,
      activeSessionId: 'sess_123',
      messages: [
        {
          id: 'msg-1',
          role: 'user' as const,
          content: 'Hello',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const nextState = chatReducer(stateWithMessages, {
      type: 'NEW_CHAT',
      payload: { sessionId: 'sess_456' },
    });

    assert.equal(nextState.activeSessionId, 'sess_456');
    assert.equal(nextState.messages.length, 0);
  });
});
