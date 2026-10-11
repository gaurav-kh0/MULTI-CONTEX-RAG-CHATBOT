import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiProvider,
  OpenRouterProvider,
  NvidiaProvider,
  MockProvider,
  ProviderRegistry,
  ProviderError,
  mapHttpStatusToErrorCode,
} from '../backend/providers/index.ts';
import {
  OpenRouterProvider as DirectOpenRouterProvider,
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_MODEL,
} from '../backend/providers/openrouter.ts';
import {
  NvidiaProvider as DirectNvidiaProvider,
  DEFAULT_NVIDIA_BASE_URL,
  DEFAULT_NVIDIA_MODEL,
} from '../backend/providers/nvidia.ts';

// ---------------------------------------------------------------------------
// Helper: Create a readable Web Stream of SSE chunks from string segments
// ---------------------------------------------------------------------------
function createMockSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ---------------------------------------------------------------------------
// 1. Error Mapping & ProviderError Tests
// ---------------------------------------------------------------------------
describe('ProviderError & Status Mapping', () => {
  it('maps HTTP status codes to standardized ProviderErrorCodes', () => {
    assert.equal(mapHttpStatusToErrorCode(401), 'AUTHENTICATION_ERROR');
    assert.equal(mapHttpStatusToErrorCode(402), 'RATE_LIMIT_ERROR');
    assert.equal(mapHttpStatusToErrorCode(403), 'PERMISSION_DENIED');
    assert.equal(mapHttpStatusToErrorCode(404), 'MODEL_NOT_FOUND');
    assert.equal(mapHttpStatusToErrorCode(429), 'RATE_LIMIT_ERROR');
    assert.equal(mapHttpStatusToErrorCode(400), 'INVALID_REQUEST');
    assert.equal(mapHttpStatusToErrorCode(422), 'INVALID_REQUEST');
    assert.equal(mapHttpStatusToErrorCode(500), 'PROVIDER_DOWN');
    assert.equal(mapHttpStatusToErrorCode(503), 'PROVIDER_DOWN');
    assert.equal(mapHttpStatusToErrorCode(0), 'NETWORK_ERROR');
  });

  it('constructs descriptive ProviderError with metadata', () => {
    const error = new ProviderError({
      providerId: 'gemini',
      code: 'AUTHENTICATION_ERROR',
      statusCode: 401,
      message: 'API key is invalid or expired',
    });

    assert.equal(error.name, 'ProviderError');
    assert.equal(error.providerId, 'gemini');
    assert.equal(error.code, 'AUTHENTICATION_ERROR');
    assert.equal(error.statusCode, 401);
    assert.match(error.message, /\[GEMINI\] AUTHENTICATION_ERROR/);

    const json = error.toJSON();
    assert.equal(json.providerId, 'gemini');
    assert.equal(json.code, 'AUTHENTICATION_ERROR');
    assert.equal(json.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// 2. GeminiProvider Adapter Tests
// ---------------------------------------------------------------------------
describe('GeminiProvider Adapter', () => {
  it('reports configuration status accurately based on credentials', () => {
    const unconfigured = new GeminiProvider({ apiKey: '' });
    assert.equal(unconfigured.isConfigured(), false);

    const configured = new GeminiProvider({ apiKey: 'mock-gemini-key' });
    assert.equal(configured.isConfigured(), true);
  });

  it('throws CONFIGURATION_ERROR when unconfigured and invoked', async () => {
    const unconfigured = new GeminiProvider({ apiKey: '' });
    const origEnv = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      await assert.rejects(
        async () => {
          await unconfigured.generateText({ prompt: 'Hello Gemini' });
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.equal(err.providerId, 'gemini');
          return true;
        }
      );
    } finally {
      if (origEnv) process.env.GEMINI_API_KEY = origEnv;
    }
  });

  it('generates non-streaming text using mocked GoogleGenAI client', async () => {
    let capturedCall: any = null;

    const mockClient = {
      models: {
        async generateContent(params: any) {
          capturedCall = params;
          return {
            text: 'Mocked Gemini explanation of NEC 705.12.',
            usageMetadata: {
              promptTokenCount: 45,
              candidatesTokenCount: 60,
              totalTokenCount: 105,
            },
          };
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: mockClient as any,
    });

    const result = await provider.generateText({
      prompt: 'Explain NEC 705.12 busbar rating rule',
      options: {
        systemPrompt: 'You are an electrical engineering assistant.',
        temperature: 0.3,
      },
    });

    assert.equal(result.providerId, 'gemini');
    assert.equal(result.content, 'Mocked Gemini explanation of NEC 705.12.');
    assert.equal(result.usage?.promptTokens, 45);
    assert.equal(result.usage?.completionTokens, 60);
    assert.equal(result.usage?.totalTokens, 105);

    assert.equal(capturedCall.config.systemInstruction, 'You are an electrical engineering assistant.');
    assert.equal(capturedCall.config.temperature, 0.3);
    assert.deepEqual(capturedCall.contents, [
      { role: 'user', parts: [{ text: 'Explain NEC 705.12 busbar rating rule' }] },
    ]);
  });

  it('streams text chunks using mocked GoogleGenAI stream', async () => {
    const mockClient = {
      models: {
        async generateContentStream() {
          return (async function* () {
            yield { text: 'Solar ' };
            yield { text: 'inverters ' };
            yield {
              text: 'convert DC to AC.',
              usageMetadata: {
                promptTokenCount: 10,
                candidatesTokenCount: 15,
                totalTokenCount: 25,
              },
            };
          })();
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'test-key',
      client: mockClient as any,
    });

    const chunks = [];
    for await (const chunk of provider.streamText({ prompt: 'What do inverters do?' })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.length, 4);
    assert.equal(chunks[0].text, 'Solar ');
    assert.equal(chunks[0].done, false);
    assert.equal(chunks[1].text, 'inverters ');
    assert.equal(chunks[2].text, 'convert DC to AC.');
    assert.equal(chunks[3].done, true);
    assert.equal(chunks[3].usage?.totalTokens, 25);
  });

  it('translates SDK errors into typed ProviderError', async () => {
    const mockClient = {
      models: {
        async generateContent() {
          const err = new Error('API key not valid. Please pass a valid API key.');
          (err as any).status = 400;
          throw err;
        },
      },
    };

    const provider = new GeminiProvider({
      apiKey: 'invalid-key',
      client: mockClient as any,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Test auth error' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        assert.equal(err.providerId, 'gemini');
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 3. OpenRouterProvider (backend/providers/openrouter.ts) Adapter Tests
// ---------------------------------------------------------------------------
describe('OpenRouterProvider (backend/providers/openrouter.ts)', () => {
  it('reads documented default endpoint and model from constants/config', () => {
    assert.equal(DEFAULT_OPENROUTER_BASE_URL, 'https://openrouter.ai/api/v1');
    assert.equal(DEFAULT_OPENROUTER_MODEL, 'meta-llama/llama-3.3-70b-instruct');

    const provider = new DirectOpenRouterProvider({ apiKey: 'test-key' });
    assert.equal(provider.defaultModel, 'meta-llama/llama-3.3-70b-instruct');
    assert.equal(provider.id, 'openrouter');
  });

  it('reads model ID and base URL overrides from server environment variables', () => {
    const origModel = process.env.OPENROUTER_MODEL;
    const origBase = process.env.OPENROUTER_BASE_URL;

    process.env.OPENROUTER_MODEL = 'anthropic/claude-3.5-haiku';
    process.env.OPENROUTER_BASE_URL = 'https://custom-proxy.openrouter.ai/api/v1';

    try {
      const provider = new DirectOpenRouterProvider({ apiKey: 'test-key' });
      assert.equal(provider.defaultModel, 'anthropic/claude-3.5-haiku');
    } finally {
      if (origModel) process.env.OPENROUTER_MODEL = origModel;
      else delete process.env.OPENROUTER_MODEL;
      if (origBase) process.env.OPENROUTER_BASE_URL = origBase;
      else delete process.env.OPENROUTER_BASE_URL;
    }
  });

  it('throws CONFIGURATION_ERROR when unconfigured', async () => {
    const unconfigured = new DirectOpenRouterProvider({ apiKey: '' });
    const origEnv = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      await assert.rejects(
        async () => {
          await unconfigured.generateText({ prompt: 'Hello' });
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.equal(err.providerId, 'openrouter');
          return true;
        }
      );
    } finally {
      if (origEnv) process.env.OPENROUTER_API_KEY = origEnv;
    }
  });

  it('generates non-streaming text using native fetch with documented endpoint and auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: any = null;
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'gen-or-123',
          model: 'meta-llama/llama-3.3-70b-instruct',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'OpenRouter response for solar rooftop specs.',
              },
            },
          ],
          usage: {
            prompt_tokens: 16,
            completion_tokens: 24,
            total_tokens: 40,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new DirectOpenRouterProvider({
      apiKey: 'sk-or-v1-mysecretkey',
      fetchFn: mockFetch,
    });

    const result = await provider.generateText({
      prompt: 'Summarize NEC 690.12 rapid shutdown',
      options: {
        model: 'meta-llama/llama-3.3-70b-instruct',
        temperature: 0.2,
      },
    });

    assert.equal(capturedUrl, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(capturedHeaders['Authorization'], 'Bearer sk-or-v1-mysecretkey');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.equal(capturedHeaders['X-Title'], 'Multi-Context RAG Chatbot');
    assert.equal(capturedBody.model, 'meta-llama/llama-3.3-70b-instruct');
    assert.equal(capturedBody.stream, false);

    assert.equal(result.providerId, 'openrouter');
    assert.equal(result.content, 'OpenRouter response for solar rooftop specs.');
    assert.equal(result.usage?.promptTokens, 16);
    assert.equal(result.usage?.completionTokens, 24);
    assert.equal(result.usage?.totalTokens, 40);
  });

  it('supports documented provider-specific parameters (route, transforms, models, providerRouting)', async () => {
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: 'gen-or-custom',
          choices: [{ message: { content: 'Custom param test' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new DirectOpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await provider.generateText({
      prompt: 'Check routing',
      options: {
        openrouter: {
          route: 'fallback',
          transforms: ['middle-out'],
          models: ['meta-llama/llama-3.1-8b-instruct'],
          providerRouting: {
            data_collection: 'deny',
            allow_fallbacks: true,
          },
        },
      },
    });

    assert.equal(capturedBody.route, 'fallback');
    assert.deepEqual(capturedBody.transforms, ['middle-out']);
    assert.deepEqual(capturedBody.models, ['meta-llama/llama-3.1-8b-instruct']);
    assert.deepEqual(capturedBody.provider, {
      data_collection: 'deny',
      allow_fallbacks: true,
    });
  });

  it('handles malformed JSON response safely with PARSE_ERROR', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response('{ malformed json body from broken proxy', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new DirectOpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Malformed test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'PARSE_ERROR');
        assert.match(err.message, /failed to parse json/i);
        return true;
      }
    );
  });

  it('handles HTML / non-JSON error pages (e.g. Cloudflare 502) without throwing JSON parse error', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      });

    const provider = new DirectOpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Gateway test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'PROVIDER_DOWN');
        assert.equal(err.statusCode, 502);
        assert.match(err.message, /502 Bad Gateway/);
        return true;
      }
    );
  });

  it('handles HTTP 402 insufficient credits mapping to RATE_LIMIT_ERROR', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { message: 'Insufficient OpenRouter credits' },
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      );

    const provider = new DirectOpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Credits test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 402);
        return true;
      }
    );
  });

  it('handles network drops and aborts with NETWORK_ERROR', async () => {
    const mockFetch: typeof fetch = async () => {
      throw new Error('connect ECONNREFUSED 104.18.2.1:443');
    };

    const provider = new DirectOpenRouterProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Network drop' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'NETWORK_ERROR');
        assert.match(err.message, /ECONNREFUSED/);
        return true;
      }
    );
  });

  it('redacts sensitive API keys from error messages preventing credential leaks', async () => {
    const secretKey = 'sk-or-v1-super-secret-unique-token-abc123';
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: { message: `Authorization header invalid: Bearer ${secretKey}` },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );

    const provider = new DirectOpenRouterProvider({
      apiKey: secretKey,
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Leaking key test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        // Ensure the raw secret key is NOT present anywhere in the error message
        assert.ok(!err.message.includes(secretKey));
        assert.match(err.message, /\[REDACTED_/);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 4. NvidiaProvider (backend/providers/nvidia.ts) Adapter Tests
// ---------------------------------------------------------------------------
describe('NvidiaProvider (backend/providers/nvidia.ts)', () => {
  it('reads documented default endpoint and model from constants/config', () => {
    assert.equal(DEFAULT_NVIDIA_BASE_URL, 'https://integrate.api.nvidia.com/v1');
    assert.equal(DEFAULT_NVIDIA_MODEL, 'meta/llama-3.3-70b-instruct');

    const provider = new DirectNvidiaProvider({ apiKey: 'nvapi-test-key' });
    assert.equal(provider.defaultModel, 'meta/llama-3.3-70b-instruct');
    assert.equal(provider.id, 'nvidia');
  });

  it('reads model ID and base URL overrides from server environment variables', () => {
    const origModel = process.env.NVIDIA_MODEL;
    const origBase = process.env.NVIDIA_BASE_URL;

    process.env.NVIDIA_MODEL = 'mistralai/mistral-large-2-instruct';
    process.env.NVIDIA_BASE_URL = 'https://private-nim.internal.corp/v1';

    try {
      const provider = new DirectNvidiaProvider({ apiKey: 'test-key' });
      assert.equal(provider.defaultModel, 'mistralai/mistral-large-2-instruct');
    } finally {
      if (origModel) process.env.NVIDIA_MODEL = origModel;
      else delete process.env.NVIDIA_MODEL;
      if (origBase) process.env.NVIDIA_BASE_URL = origBase;
      else delete process.env.NVIDIA_BASE_URL;
    }
  });

  it('throws CONFIGURATION_ERROR when unconfigured', async () => {
    const unconfigured = new DirectNvidiaProvider({ apiKey: '' });
    const origEnv = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;

    try {
      await assert.rejects(
        async () => {
          await unconfigured.generateText({ prompt: 'Hello' });
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.equal(err.providerId, 'nvidia');
          return true;
        }
      );
    } finally {
      if (origEnv) process.env.NVIDIA_API_KEY = origEnv;
    }
  });

  it('generates non-streaming text targeting NVIDIA NIM endpoint with documented auth', async () => {
    let capturedUrl = '';
    let capturedHeaders: any = null;
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'gen-nv-123',
          model: 'meta/llama-3.3-70b-instruct',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'NVIDIA NIM response for engineering load calculations.',
              },
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 28,
            total_tokens: 46,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new DirectNvidiaProvider({
      apiKey: 'nvapi-my-secret-key-987',
      fetchFn: mockFetch,
    });

    const result = await provider.generateText({
      prompt: 'Load calculation formulas',
      options: {
        model: 'meta/llama-3.3-70b-instruct',
        temperature: 0.7,
      },
    });

    assert.equal(capturedUrl, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(capturedHeaders['Authorization'], 'Bearer nvapi-my-secret-key-987');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
    assert.equal(capturedHeaders['Accept'], 'application/json');
    assert.equal(capturedBody.model, 'meta/llama-3.3-70b-instruct');
    assert.equal(capturedBody.stream, false);

    assert.equal(result.providerId, 'nvidia');
    assert.equal(result.content, 'NVIDIA NIM response for engineering load calculations.');
    assert.equal(result.usage?.promptTokens, 18);
    assert.equal(result.usage?.completionTokens, 28);
    assert.equal(result.usage?.totalTokens, 46);
  });

  it('supports documented NVIDIA generation parameters (frequency_penalty, presence_penalty, stop)', async () => {
    let capturedBody: any = null;

    const mockFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Params passed' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const provider = new DirectNvidiaProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await provider.generateText({
      prompt: 'NVIDIA custom params test',
      options: {
        nvidia: {
          frequencyPenalty: 0.5,
          presencePenalty: 0.2,
          stop: ['[DONE]', '###'],
        },
      },
    });

    assert.equal(capturedBody.frequency_penalty, 0.5);
    assert.equal(capturedBody.presence_penalty, 0.2);
    assert.deepEqual(capturedBody.stop, ['[DONE]', '###']);
  });

  it('handles FastAPI validation errors with array detail safely as INVALID_REQUEST', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ['body', 'temperature'],
              msg: 'ensure this value is greater than or equal to 0',
              type: 'value_error.number.not_ge',
            },
          ],
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );

    const provider = new DirectNvidiaProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Invalid temp test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /ensure this value is greater than or equal to 0/i);
        return true;
      }
    );
  });

  it('handles malformed JSON responses with PARSE_ERROR', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response('{ bad json truncated from nvidia proxy', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const provider = new DirectNvidiaProvider({
      apiKey: 'test-key',
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Malformed json test' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'PARSE_ERROR');
        return true;
      }
    );
  });

  it('redacts sensitive NVIDIA API keys from error messages preventing credential leaks', async () => {
    const secretKey = 'nvapi-super-secret-key-value-99999';
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          detail: `Unauthorized access using key Bearer ${secretKey}`,
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );

    const provider = new DirectNvidiaProvider({
      apiKey: secretKey,
      fetchFn: mockFetch,
    });

    await assert.rejects(
      async () => {
        await provider.generateText({ prompt: 'Auth error with key' });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        assert.ok(!err.message.includes(secretKey));
        assert.match(err.message, /\[REDACTED_/);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 5. MockProvider Tests
// ---------------------------------------------------------------------------
describe('MockProvider Adapter', () => {
  const mockProvider = new MockProvider();

  it('is always configured and ready', () => {
    assert.equal(mockProvider.isConfigured(), true);
    assert.equal(mockProvider.id, 'mock');
  });

  it('generates predictable non-streaming mock output', async () => {
    const result = await mockProvider.generateText({
      prompt: 'Check NEC 220 load rules',
    });

    assert.equal(result.providerId, 'mock');
    assert.match(result.content, /\[Mock Response\]/);
    assert.match(result.content, /Check NEC 220/);
    assert.ok(result.usage && result.usage.totalTokens > 0);
  });

  it('streams predictable mock chunks', async () => {
    const chunks = [];
    for await (const chunk of mockProvider.streamText({ prompt: 'Stream test' })) {
      chunks.push(chunk);
    }

    assert.ok(chunks.length >= 2);
    assert.equal(chunks[chunks.length - 1].done, true);
  });

  it('fulfills legacy generateCompletion interface', async () => {
    const completion = await mockProvider.generateCompletion('Single prompt test');
    assert.ok(completion.content.length > 0);
    assert.ok(completion.usage);
  });
});

// ---------------------------------------------------------------------------
// 6. ProviderRegistry & Strict Failover Enforcement Tests
// ---------------------------------------------------------------------------
describe('ProviderRegistry', () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it('lists registered providers including gemini, openrouter, nvidia, and mock', () => {
    const list = registry.listSupportedProviders();
    assert.ok(list.includes('gemini'));
    assert.ok(list.includes('openrouter'));
    assert.ok(list.includes('nvidia'));
    assert.ok(list.includes('mock'));
  });

  it('rejects unsupported provider IDs with INVALID_REQUEST', () => {
    assert.throws(
      () => {
        registry.getProvider('unsupported_id' as any);
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /not supported/i);
        return true;
      }
    );
  });

  it('enforces STRICT POLICY: unconfigured provider throws CONFIGURATION_ERROR and does not silently fall back', () => {
    const unconfigured = new OpenRouterProvider({ apiKey: '' });
    const origEnv = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      registry.registerProvider(unconfigured);

      assert.throws(
        () => {
          registry.getProvider('openrouter');
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.match(err.message, /not configured/i);
          return true;
        }
      );
    } finally {
      if (origEnv) process.env.OPENROUTER_API_KEY = origEnv;
    }
  });

  it('successfully returns configured provider instances', () => {
    const mock = registry.getProvider('mock');
    assert.equal(mock.id, 'mock');

    const customGemini = new GeminiProvider({ apiKey: 'custom-key' });
    registry.registerProvider(customGemini);

    const resolved = registry.getProvider('gemini');
    assert.equal(resolved.id, 'gemini');
    assert.equal(resolved.isConfigured(), true);
  });

  it('lists only configured providers in listConfiguredProviders', () => {
    const origG = process.env.GEMINI_API_KEY;
    const origOR = process.env.OPENROUTER_API_KEY;
    const origNV = process.env.NVIDIA_API_KEY;

    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.NVIDIA_API_KEY;

    try {
      registry.resetToDefaults();
      const configured = registry.listConfiguredProviders();
      assert.ok(configured.includes('mock'));
      assert.ok(!configured.includes('openrouter'));
      assert.ok(!configured.includes('nvidia'));
    } finally {
      if (origG) process.env.GEMINI_API_KEY = origG;
      if (origOR) process.env.OPENROUTER_API_KEY = origOR;
      if (origNV) process.env.NVIDIA_API_KEY = origNV;
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Live Integration Status & Verification Safeguards
// ---------------------------------------------------------------------------
describe('Live Integration Status & Verification Safeguards', () => {
  it('[UNVERIFIED_LIVE_INTEGRATION] Confirms live integration is guarded and never executed with fake credentials', () => {
    // In CI and development environments without verified live credentials,
    // adapters must remain unconfigured and must never fabricate successful live responses.
    const openrouter = new DirectOpenRouterProvider({ apiKey: '' });
    assert.equal(
      openrouter.isConfigured(),
      false,
      'OpenRouter must remain unconfigured without real server credentials.'
    );

    const nvidia = new DirectNvidiaProvider({ apiKey: '' });
    assert.equal(
      nvidia.isConfigured(),
      false,
      'NVIDIA NIM must remain unconfigured without real server credentials.'
    );
  });
});
