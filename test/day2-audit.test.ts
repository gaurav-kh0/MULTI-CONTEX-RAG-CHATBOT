import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiProvider,
  OpenRouterProvider,
  NvidiaProvider,
  MockProvider,
  ProviderRegistry,
  ProviderError,
} from '../backend/providers/index.ts';
import {
  ChatService,
} from '../backend/services/chat-service.ts';
import {
  parseChatStream,
  StreamInterruptedError,
} from '../lib/stream-parser.ts';
import { formatSseEvent } from '../lib/stream-protocol.ts';
import {
  chatReducer,
  initialState,
} from '../hooks/useChatState.ts';
import type {
  ChatAction,
  ChatState,
} from '../hooks/useChatState.ts';
import type {
  ChatMessage,
  ChatSession,
} from '../lib/types.ts';
import type {
  ProviderGenerateRequest,
  ProviderStreamChunk,
} from '../backend/providers/types.ts';

// ---------------------------------------------------------------------------
// 1. Gemini Adapter Verification (Mocked Valid vs Invalid/Missing Keys)
// ---------------------------------------------------------------------------
describe('Day 2 Audit - Gemini Adapter', () => {
  it('generates text successfully when configured with a valid key (mocked)', async () => {
    const mockSdkClient = {
      models: {
        async generateContent(params: any) {
          assert.equal(params.model, 'gemini-2.5-flash');
          assert.ok(params.contents.length > 0);
          return {
            text: 'Mocked Gemini answer on photovoltaic system grounding.',
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 22, totalTokenCount: 37 },
          };
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'valid-mock-key',
      client: mockSdkClient as any,
    });

    assert.equal(provider.isConfigured(), true);
    assert.equal(provider.supportsStreaming(), true);

    const result = await provider.generateText({
      prompt: 'Explain NEC 690 grounding',
    });

    assert.equal(result.providerId, 'gemini');
    assert.equal(result.content, 'Mocked Gemini answer on photovoltaic system grounding.');
    assert.equal(result.usage?.totalTokens, 37);
  });

  it('streams text chunks successfully when configured with a valid key (mocked)', async () => {
    const mockStreamChunks = [
      { text: 'Grounding ', usageMetadata: undefined },
      { text: 'requires ', usageMetadata: undefined },
      { text: 'equipment grounding conductor.', usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 15, totalTokenCount: 25 } },
    ];

    const mockSdkClient = {
      models: {
        async generateContentStream() {
          return (async function* () {
            for (const c of mockStreamChunks) {
              yield c;
            }
          })();
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'valid-mock-key',
      client: mockSdkClient as any,
    });

    const chunks: ProviderStreamChunk[] = [];
    for await (const chunk of provider.streamText({ prompt: 'Grounding rules' })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 4);
    assert.equal(chunks[0].text, 'Grounding ');
    assert.equal(chunks[1].text, 'requires ');
    assert.equal(chunks[2].text, 'equipment grounding conductor.');
    assert.equal(chunks[3].done, true);
    assert.equal(chunks[3].usage?.totalTokens, 25);
  });

  it('rejects execution with CONFIGURATION_ERROR when credentials are missing', async () => {
    const unconfigured = new GeminiProvider({ apiKey: '' });
    assert.equal(unconfigured.isConfigured(), false);

    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      await assert.rejects(
        async () => {
          await unconfigured.generateText({ prompt: 'Should fail' });
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          return true;
        }
      );
    } finally {
      if (origKey) process.env.GEMINI_API_KEY = origKey;
    }
  });

  it('maps invalid API key / authentication rejection to AUTHENTICATION_ERROR', async () => {
    const mockSdkClient = {
      models: {
        async generateContent() {
          const authError = new Error('API key not valid. Please pass a valid API key.');
          (authError as any).status = 401;
          throw authError;
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'bad-key',
      client: mockSdkClient as any,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Auth test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        return true;
      }
    );
  });

  it('maps resource exhaustion to RATE_LIMIT_ERROR', async () => {
    const mockSdkClient = {
      models: {
        async generateContent() {
          const rateErr = new Error('Resource has been exhausted (e.g. check quota).');
          (rateErr as any).status = 429;
          throw rateErr;
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: mockSdkClient as any,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Quota test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 2. OpenRouter & NVIDIA Adapter Verification
// ---------------------------------------------------------------------------
describe('Day 2 Audit - OpenRouter & NVIDIA NIM Adapters', () => {
  it('OpenRouter: handles HTTP 401 invalid credentials mapping to AUTHENTICATION_ERROR', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API Key provided' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new OpenRouterProvider({
      apiKey: 'invalid-or-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'OpenRouter auth' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  it('OpenRouter: handles HTTP 429 rate limit errors properly', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Rate limit' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 429);
        return true;
      }
    );
  });

  it('NVIDIA NIM: handles HTTP 401 invalid credentials mapping to AUTHENTICATION_ERROR', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ detail: 'Authentication failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new NvidiaProvider({
      apiKey: 'invalid-nv-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'NVIDIA auth' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        assert.equal(err.statusCode, 401);
        return true;
      }
    );
  });

  it('NVIDIA NIM: handles HTTP 429 rate limits properly', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ detail: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new NvidiaProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'NVIDIA rate limit' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 429);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Central Service Routing, History, and Model Controls
// ---------------------------------------------------------------------------
describe('Day 2 Audit - ChatService Routing & Validation', () => {
  it('rejects empty and whitespace-only messages with INVALID_REQUEST', async () => {
    const service = new ChatService({ defaultProviderId: 'mock' });

    await assert.rejects(
      async () => {
        await service.processMessage({ message: '   ' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /cannot be empty/i);
        return true;
      }
    );
  });

  it('rejects unauthorized/unsupported model selections with INVALID_REQUEST', async () => {
    const registry = new ProviderRegistry();
    const mockProvider = new MockProvider();
    registry.registerProvider(mockProvider);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
      allowedModels: {
        mock: ['mock-model-v1'],
      },
    });

    await assert.rejects(
      async () => {
        await service.processMessage({
          message: 'Valid query',
          providerId: 'mock',
          model: 'unauthorized-gpt-5',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /not allowed for provider 'mock'/i);
        return true;
      }
    );
  });

  it('strictly limits conversation history to configurable recent window', async () => {
    class RecordingProvider extends MockProvider {
      public capturedRequest?: ProviderGenerateRequest;

      override async generateText(request: ProviderGenerateRequest) {
        this.capturedRequest = request;
        return super.generateText(request);
      }
    }

    const recordingProvider = new RecordingProvider();
    const registry = new ProviderRegistry();
    registry.registerProvider(recordingProvider);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
      maxHistoryMessages: 2, // Limit window to 2
    });

    const session = await service.createSession('Window test session');
    session.messages.push(
      { id: 'm1', role: 'user', content: 'Turn 1', timestamp: '2026-10-11T10:00:00Z', contexts: ['GENERAL'] },
      { id: 'm2', role: 'assistant', content: 'Turn 2', timestamp: '2026-10-11T10:01:00Z', contexts: ['GENERAL'] },
      { id: 'm3', role: 'user', content: 'Turn 3', timestamp: '2026-10-11T10:02:00Z', contexts: ['GENERAL'] },
      { id: 'm4', role: 'assistant', content: 'Turn 4', timestamp: '2026-10-11T10:03:00Z', contexts: ['GENERAL'] }
    );

    await service.processMessage({
      sessionId: session.id,
      message: 'Turn 5',
      contexts: ['GENERAL'],
      providerId: 'mock',
    });

    const sent = recordingProvider.capturedRequest?.messages || [];
    // Should have sliced to last 2 historical (m3, m4) + 1 current = 3 messages
    assert.equal(sent.length, 3);
    assert.equal(sent[0].content, 'Turn 3');
    assert.equal(sent[1].content, 'Turn 4');
    assert.equal(sent[2].content, 'Turn 5');
  });

  it('enforces strict policy: unconfigured provider throws CONFIGURATION_ERROR without silent fallback', async () => {
    const registry = new ProviderRegistry();
    const unconfiguredGemini = new GeminiProvider({ apiKey: '' });
    registry.registerProvider(unconfiguredGemini);

    const service = new ChatService({
      registry,
      defaultProviderId: 'gemini',
    });

    await assert.rejects(
      async () => {
        await service.processMessage({
          message: 'Hello unconfigured',
          providerId: 'gemini',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.match(err.message, /not configured/i);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Streaming Success & Interruption Handling
// ---------------------------------------------------------------------------
describe('Day 2 Audit - Streaming Success & Interruption', () => {
  it('successfully streams tokens progressively over Web Stream', async () => {
    const ssePayload = [
      formatSseEvent({
        type: 'session',
        data: {
          sessionId: 's1',
          userMessage: { id: 'u1', role: 'user', content: 'Hi', timestamp: '2026-10-11T12:00:00Z', contexts: ['GENERAL'] },
        },
      }),
      formatSseEvent({ type: 'delta', data: { text: 'Hello ', providerId: 'gemini', model: 'gemini-2.5-flash' } }),
      formatSseEvent({ type: 'delta', data: { text: 'world!', providerId: 'gemini', model: 'gemini-2.5-flash' } }),
      formatSseEvent({
        type: 'done',
        data: {
          sessionId: 's1',
          assistantMessage: { id: 'a1', role: 'assistant', content: 'Hello world!', timestamp: '2026-10-11T12:00:01Z', contexts: ['GENERAL'] },
          session: { id: 's1', title: 'T', messages: [], activeContexts: ['GENERAL'], activeContextScopeIds: [], createdAt: '', updatedAt: '' },
        },
      }),
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const item of ssePayload) {
          ctrl.enqueue(encoder.encode(item));
        }
        ctrl.close();
      },
    });

    const receivedTokens: string[] = [];
    let isFinished = false;

    await parseChatStream(stream, {
      onDelta: (d) => receivedTokens.push(d.text),
      onDone: () => {
        isFinished = true;
      },
    });

    assert.deepEqual(receivedTokens, ['Hello ', 'world!']);
    assert.equal(isFinished, true);
  });

  it('detects severed connection before done and throws StreamInterruptedError', async () => {
    const encoder = new TextEncoder();
    const truncatedStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode(formatSseEvent({
          type: 'delta',
          data: { text: 'Incomplete...', providerId: 'gemini', model: 'gemini-2.5-flash' },
        })));
        // Abruptly close without 'done' event
        ctrl.close();
      },
    });

    let reportedError: any;
    let threwInterrupted = false;

    try {
      await parseChatStream(truncatedStream, {
        onError: (err) => {
          reportedError = err;
        },
      });
    } catch (err) {
      if (err instanceof StreamInterruptedError) {
        threwInterrupted = true;
      }
    }

    assert.equal(threwInterrupted, true, 'Must throw StreamInterruptedError on dropped connection');
    assert.equal(reportedError?.code, 'INTERRUPTED_STREAM');
  });
});

// ---------------------------------------------------------------------------
// 5. Client-Side Error Display & State Transitions
// ---------------------------------------------------------------------------
describe('Day 2 Audit - Client-Side Error Display State Machine', () => {
  it('transitions cleanly to recoverable error state on STREAM_ERROR', () => {
    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'Query about 705.12',
      timestamp: '2026-10-11T12:00:00Z',
    };
    const placeholderMsg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: '',
      timestamp: '2026-10-11T12:00:00Z',
    };

    // 1. Submit start
    let state = chatReducer(initialState, {
      type: 'SUBMIT_START',
      payload: {
        userMessage: userMsg,
        assistantPlaceholder: placeholderMsg,
        rawText: 'Query about 705.12',
      },
    });

    assert.equal(state.isLoading, true);
    assert.equal(state.messages.length, 2);
    assert.equal(state.lastFailedMessage, 'Query about 705.12');
    assert.equal(state.error, null);

    // 2. Stream error occurs before tokens arrive
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: {
        assistantMessageId: 'a1',
        error: 'Provider rate limit exceeded. Please try again shortly.',
      },
    });

    assert.equal(state.isLoading, false);
    assert.equal(state.error, 'Provider rate limit exceeded. Please try again shortly.');
    // Empty assistant placeholder must have been cleaned up
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].id, 'u1');

    // 3. Clear error
    state = chatReducer(state, { type: 'CLEAR_ERROR' });
    assert.equal(state.error, null);
  });

  it('preserves partially streamed tokens on stream interruption for transparent debugging', () => {
    const userMsg: ChatMessage = { id: 'u1', role: 'user', content: 'Tell me a story', timestamp: '2026-10-11T12:00:00Z' };
    const placeholderMsg: ChatMessage = { id: 'a1', role: 'assistant', content: '', timestamp: '2026-10-11T12:00:00Z' };

    let state = chatReducer(initialState, {
      type: 'SUBMIT_START',
      payload: { userMessage: userMsg, assistantPlaceholder: placeholderMsg, rawText: 'Tell me a story' },
    });

    // Received partial delta
    state = chatReducer(state, {
      type: 'STREAM_DELTA',
      payload: { assistantMessageId: 'a1', text: 'Once upon a time...' },
    });

    assert.equal(state.messages[1].content, 'Once upon a time...');

    // Now error occurs
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: { assistantMessageId: 'a1', error: 'Connection lost' },
    });

    assert.equal(state.isLoading, false);
    assert.equal(state.error, 'Connection lost');
    // Non-empty message is retained
    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[1].content, 'Once upon a time...');
  });

  it('cleans up empty placeholder on user cancellation', () => {
    const userMsg: ChatMessage = { id: 'u1', role: 'user', content: 'Cancelled query', timestamp: '2026-10-11T12:00:00Z' };
    const placeholderMsg: ChatMessage = { id: 'a1', role: 'assistant', content: '', timestamp: '2026-10-11T12:00:00Z' };

    let state = chatReducer(initialState, {
      type: 'SUBMIT_START',
      payload: { userMessage: userMsg, assistantPlaceholder: placeholderMsg, rawText: 'Cancelled query' },
    });

    assert.equal(state.messages.length, 2);
    assert.equal(state.isLoading, true);

    state = chatReducer(state, { type: 'CANCEL_REQUEST' });

    assert.equal(state.isLoading, false);
    // Empty placeholder removed cleanly
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].id, 'u1');
  });
});
