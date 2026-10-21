import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChatService,
} from '../backend/services/chat-service.ts';
import {
  ProviderRegistry,
  OpenRouterProvider,
  ProviderError,
} from '../backend/providers/index.ts';
import type {
  ILlmProviderAdapter,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderStreamChunk,
} from '../backend/providers/types.ts';
import type { ChatStreamEvent } from '../lib/stream-protocol.ts';

// ---------------------------------------------------------------------------
// Custom Test Provider for spying on calls
// ---------------------------------------------------------------------------
class SpyProvider implements ILlmProviderAdapter {
  readonly id = 'mock';
  readonly name = 'Spy Mock Provider';
  readonly defaultModel = 'mock-spy-v1';
  public lastRequest?: ProviderGenerateRequest;
  public failWithError?: Error;

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    this.lastRequest = request;

    if (this.failWithError) {
      throw this.failWithError;
    }

    return {
      content: `[Spy Response] Answer to: ${request.messages?.[request.messages.length - 1]?.content || ''}`,
      providerId: this.id,
      model: request.options?.model || this.defaultModel,
      usage: {
        promptTokens: 12,
        completionTokens: 20,
        totalTokens: 32,
      },
    };
  }

  async *streamText(_request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    yield { text: 'chunk', done: true, providerId: this.id, model: this.defaultModel };
  }

  async generateCompletion(prompt: string) {
    const res = await this.generateText({ prompt });
    return { content: res.content, usage: res.usage };
  }
}

// ---------------------------------------------------------------------------
// 1. Validation Tests
// ---------------------------------------------------------------------------
describe('ChatService - Validation', () => {
  let service: ChatService;

  beforeEach(() => {
    service = new ChatService({
      defaultProviderId: 'mock',
    });
  });

  it('rejects empty or whitespace-only messages', async () => {
    await assert.rejects(
      async () => {
        await service.processMessage({ message: '   ', contexts: ['NEC'] });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /cannot be empty/i);
        return true;
      }
    );
  });

  it('rejects oversized user messages exceeding max length', async () => {
    const hugeMessage = 'x'.repeat(4500);
    await assert.rejects(
      async () => {
        await service.processMessage({ message: hugeMessage, contexts: ['GENERAL'] });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /exceeds maximum allowed length/i);
        return true;
      }
    );
  });

  it('rejects invalid context types', async () => {
    await assert.rejects(
      async () => {
        await service.processMessage({
          message: 'Valid query',
          contexts: ['INVALID_CONTEXT_TYPE' as any],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /invalid context/i);
        return true;
      }
    );
  });

  it('defaults to GENERAL context when contexts are empty or omitted', async () => {
    const result = await service.processMessage({
      message: 'Explain basic inverter mechanics',
    });

    assert.deepEqual(result.userMessage.contexts, ['GENERAL']);
    assert.deepEqual(result.assistantMessage.contexts, ['GENERAL']);
  });
});

// ---------------------------------------------------------------------------
// 2. Provider & Model Routing Tests
// ---------------------------------------------------------------------------
describe('ChatService - Provider & Model Routing', () => {
  let registry: ProviderRegistry;
  let spyProvider: SpyProvider;
  let service: ChatService;

  beforeEach(() => {
    registry = new ProviderRegistry();
    spyProvider = new SpyProvider();
    registry.registerProvider(spyProvider);

    service = new ChatService({
      registry,
      defaultProviderId: 'mock',
      allowedModels: {
        mock: ['mock-spy-v1', 'mock-permitted-v2'],
      },
    });
  });

  it('routes to requested provider and uses default model when unspecified', async () => {
    const result = await service.processMessage({
      message: 'Routing test',
      providerId: 'mock',
    });

    assert.equal(result.assistantMessage.providerId, 'mock');
    assert.equal(spyProvider.lastRequest?.options?.model, 'mock-spy-v1');
    assert.match(result.assistantMessage.content, /\[Spy Response\]/);
  });

  it('accepts permitted models defined in server configuration', async () => {
    await service.processMessage({
      message: 'Model test',
      providerId: 'mock',
      model: 'mock-permitted-v2',
    });

    assert.equal(spyProvider.lastRequest?.options?.model, 'mock-permitted-v2');
  });

  it('rejects unpermitted models with INVALID_REQUEST', async () => {
    await assert.rejects(
      async () => {
        await service.processMessage({
          message: 'Hack model test',
          providerId: 'mock',
          model: 'unauthorized-gpt-5-turbo',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'INVALID_REQUEST');
        assert.match(err.message, /not allowed for provider/i);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 3. System Instructions & Security Safeguards
// ---------------------------------------------------------------------------
describe('ChatService - System Instructions & Security', () => {
  let spyProvider: SpyProvider;
  let registry: ProviderRegistry;
  let service: ChatService;

  beforeEach(() => {
    registry = new ProviderRegistry();
    spyProvider = new SpyProvider();
    registry.registerProvider(spyProvider);
    service = new ChatService({ registry, defaultProviderId: 'mock' });
  });

  it('builds domain-specific system instruction for NEC partition', async () => {
    await service.processMessage({
      message: 'What is NEC 690.12?',
      contexts: ['NEC'],
    });

    const systemPrompt = spyProvider.lastRequest?.options?.systemPrompt;
    assert.ok(systemPrompt);
    assert.match(systemPrompt, /National Electrical Code \(NEC\)/);
    assert.match(systemPrompt, /NFPA 70/);
    assert.match(systemPrompt, /rapid shutdown compliance/);
  });

  it('builds domain-specific system instruction for Wattmonk partition', async () => {
    await service.processMessage({
      message: 'How to prepare solar plan-set?',
      contexts: ['WATTMONK'],
    });

    const systemPrompt = spyProvider.lastRequest?.options?.systemPrompt;
    assert.ok(systemPrompt);
    assert.match(systemPrompt, /Solar PV engineering and plan-set specialist for Wattmonk/);
    assert.match(systemPrompt, /AHJ permitting/);
  });

  it('combines domain instructions when multiple contexts are active', async () => {
    await service.processMessage({
      message: 'NEC compliance for Wattmonk plan-set',
      contexts: ['NEC', 'WATTMONK'],
    });

    const systemPrompt = spyProvider.lastRequest?.options?.systemPrompt;
    assert.ok(systemPrompt);
    assert.match(systemPrompt, /National Electrical Code/);
    assert.match(systemPrompt, /Wattmonk/);
  });

  it('does not send secrets or internal metadata in LLM message history', async () => {
    await service.processMessage({
      message: 'Check payload security',
      contexts: ['GENERAL'],
    });

    const messages = spyProvider.lastRequest?.messages;
    assert.ok(messages && messages.length > 0);

    // Each message must strictly be role & content without extra internals
    for (const msg of messages) {
      assert.ok(['user', 'assistant'].includes(msg.role));
      assert.equal(typeof msg.content, 'string');
      // No auth tokens or session metadata leaked in content
      assert.ok(!msg.content.includes('process.env'));
      assert.ok(!msg.content.includes('Bearer '));
    }
  });
});

// ---------------------------------------------------------------------------
// 4. History Windowing Tests
// ---------------------------------------------------------------------------
describe('ChatService - History Windowing', () => {
  it('strictly limits conversation history to configurable recent window', async () => {
    const spy = new SpyProvider();
    const registry = new ProviderRegistry();
    registry.registerProvider(spy);

    // Configure a small history window of 3 messages
    const windowService = new ChatService({
      registry,
      defaultProviderId: 'mock',
      maxHistoryMessages: 3,
    });

    const session = await windowService.createSession('Long conversation');

    // Manually push 8 historical messages
    for (let i = 1; i <= 8; i++) {
      session.messages.push({
        id: `msg_${i}`,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content: `History turn ${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    // Submit a 9th message
    await windowService.processMessage({
      sessionId: session.id,
      message: 'Current query 9',
    });

    const sentMessages = spy.lastRequest?.messages;
    assert.ok(sentMessages);

    // Total sent must be 3 historical + 1 new = 4 messages
    assert.equal(sentMessages.length, 4);

    // First sent message should be History turn 6 (since history was sliced to last 3: 6, 7, 8)
    assert.equal(sentMessages[0].content, 'History turn 6');
    assert.equal(sentMessages[1].content, 'History turn 7');
    assert.equal(sentMessages[2].content, 'History turn 8');
    assert.equal(sentMessages[3].content, 'Current query 9');
  });
});

// ---------------------------------------------------------------------------
// 5. Missing Configuration Tests
// ---------------------------------------------------------------------------
describe('ChatService - Missing Configuration', () => {
  it('throws CONFIGURATION_ERROR when requested provider is unconfigured', async () => {
    const registry = new ProviderRegistry();
    const unconfiguredOpenRouter = new OpenRouterProvider({ apiKey: '' });
    registry.registerProvider(unconfiguredOpenRouter);

    const service = new ChatService({
      registry,
      defaultProviderId: 'openrouter',
    });

    await assert.rejects(
      async () => {
        await service.processMessage({
          message: 'Hello unconfigured',
          providerId: 'openrouter',
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
// 6. Provider Failure Handling (No Fabricated Answers)
// ---------------------------------------------------------------------------
describe('ChatService - Provider Failure Handling', () => {
  it('propagates provider failure and NEVER fabricates an answer or saves broken session state', async () => {
    const spy = new SpyProvider();
    spy.failWithError = new ProviderError({
      providerId: 'mock',
      code: 'RATE_LIMIT_ERROR',
      statusCode: 429,
      message: 'Rate limit exceeded on upstream provider',
    });

    const registry = new ProviderRegistry();
    registry.registerProvider(spy);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
    });

    const session = await service.createSession('Clean session');
    const initialMessageCount = session.messages.length;

    await assert.rejects(
      async () => {
        await service.processMessage({
          sessionId: session.id,
          message: 'Should fail cleanly without fake response',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 429);
        return true;
      }
    );

    // Verify NO messages were appended to the session on failure
    assert.equal(
      session.messages.length,
      initialMessageCount,
      'No messages should be persisted when provider generation fails.'
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Typed Response Structure Tests
// ---------------------------------------------------------------------------
describe('ChatService - Typed Response Structure', () => {
  it('returns valid ChatResponsePayload with provider metadata and session reference', async () => {
    const service = new ChatService({
      defaultProviderId: 'mock',
    });

    const result = await service.processMessage({
      message: 'Show me NEC 705.12 requirements',
      contexts: ['NEC'],
      providerId: 'mock',
    });

    assert.ok(result.sessionId);
    assert.equal(result.userMessage.role, 'user');
    assert.equal(result.userMessage.content, 'Show me NEC 705.12 requirements');
    assert.deepEqual(result.userMessage.contexts, ['NEC']);

    assert.equal(result.assistantMessage.role, 'assistant');
    assert.ok(result.assistantMessage.content.length > 0);
    assert.equal(result.assistantMessage.providerId, 'mock');
    assert.ok(result.assistantMessage.usage);
    assert.deepEqual(result.references, []);

    // Session contains both user and assistant message
    assert.ok(result.session.messages.length >= 2);
    const lastMsg = result.session.messages[result.session.messages.length - 1];
    assert.equal(lastMsg.id, result.assistantMessage.id);
  });
});

// ---------------------------------------------------------------------------
// 8. Streaming Message Generation Tests
// ---------------------------------------------------------------------------
class StreamingSpyProvider extends SpyProvider {
  public chunks: string[] = ['Chunk 1 ', 'Chunk 2 ', 'Chunk 3'];
  public failDuringStream?: Error;
  public streamingSupported = true;

  supportsStreaming(): boolean {
    return this.streamingSupported;
  }

  override async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    this.lastRequest = request;
    for (const chunk of this.chunks) {
      if (this.failDuringStream) {
        throw this.failDuringStream;
      }
      if (request.options?.abortSignal?.aborted) {
        return;
      }
      yield {
        text: chunk,
        done: false,
        providerId: this.id,
        model: this.defaultModel,
      };
    }
    yield {
      text: '',
      done: true,
      providerId: this.id,
      model: this.defaultModel,
      usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
    };
  }
}

describe('ChatService - Streaming Message Generation', () => {
  it('streams session, deltas, and done events progressively', async () => {
    const streamingSpy = new StreamingSpyProvider();
    const registry = new ProviderRegistry();
    registry.registerProvider(streamingSpy);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of service.streamMessage({
      message: 'Explain PV rapid shutdown',
      contexts: ['NEC'],
      providerId: 'mock',
    })) {
      events.push(event);
    }

    // 1. Session event
    assert.equal(events[0]?.type, 'session');
    if (events[0]?.type === 'session') {
      assert.equal(events[0].data.userMessage.content, 'Explain PV rapid shutdown');
      assert.deepEqual(events[0].data.userMessage.contexts, ['NEC']);
    }

    // 2. Delta events
    const deltaEvents = events.filter((e) => e.type === 'delta');
    assert.equal(deltaEvents.length, 3);
    const textPieces = deltaEvents.map((e) => (e.type === 'delta' ? e.data.text : ''));
    assert.deepEqual(textPieces, ['Chunk 1 ', 'Chunk 2 ', 'Chunk 3']);

    // 3. Done event
    const doneEvent = events.find((e) => e.type === 'done');
    assert.ok(doneEvent);
    if (doneEvent && doneEvent.type === 'done') {
      assert.equal(
        doneEvent.data.assistantMessage.content,
        'Chunk 1 Chunk 2 Chunk 3'
      );
      assert.equal(doneEvent.data.assistantMessage.providerId, 'mock');
      assert.ok(doneEvent.data.assistantMessage.usage);
      assert.equal(doneEvent.data.session.messages.length, 2);
    }
  });

  it('yields non_streaming event when provider adapter does not support streaming', async () => {
    const nonStreamingSpy = new StreamingSpyProvider();
    nonStreamingSpy.streamingSupported = false;

    const registry = new ProviderRegistry();
    registry.registerProvider(nonStreamingSpy);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
    });

    const events: ChatStreamEvent[] = [];
    for await (const event of service.streamMessage({
      message: 'Test non-streaming fallback',
      contexts: ['GENERAL'],
      providerId: 'mock',
    })) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'non_streaming');
    if (events[0].type === 'non_streaming') {
      assert.equal(events[0].data.userMessage.content, 'Test non-streaming fallback');
      assert.ok(events[0].data.assistantMessage.content.length > 0);
    }
  });

  it('propagates provider streaming failure and NEVER persists corrupted assistant message', async () => {
    const failingSpy = new StreamingSpyProvider();
    failingSpy.failDuringStream = new ProviderError({
      providerId: 'mock',
      code: 'NETWORK_ERROR',
      message: 'Upstream socket severed mid-stream.',
    });

    const registry = new ProviderRegistry();
    registry.registerProvider(failingSpy);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
    });

    const session = await service.createSession('Test Session');
    const initialCount = session.messages.length;

    let caughtError: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _event of service.streamMessage({
        sessionId: session.id,
        message: 'This will fail midway',
        contexts: ['GENERAL'],
        providerId: 'mock',
      })) {
        // iterate
      }
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError instanceof ProviderError);
    assert.equal((caughtError as ProviderError).code, 'NETWORK_ERROR');

    // Verify session does NOT have an assistant message saved
    const assistantMessages = session.messages.filter((m) => m.role === 'assistant');
    assert.equal(
      assistantMessages.length,
      0,
      'Assistant message must not be persisted on stream error.'
    );
    assert.equal(session.messages.length, initialCount, 'Session messages should be rolled back on stream error');
  });

  it('stops streaming when AbortSignal is cancelled', async () => {
    const streamingSpy = new StreamingSpyProvider();
    const registry = new ProviderRegistry();
    registry.registerProvider(streamingSpy);

    const service = new ChatService({
      registry,
      defaultProviderId: 'mock',
    });

    const controller = new AbortController();
    const events: ChatStreamEvent[] = [];

    for await (const event of service.streamMessage(
      {
        message: 'Abort test',
        contexts: ['GENERAL'],
        providerId: 'mock',
      },
      { signal: controller.signal }
    )) {
      events.push(event);
      // Abort immediately after receiving session event
      if (event.type === 'session') {
        controller.abort();
      }
    }

    // Should not have reached done event
    const doneEvent = events.find((e) => e.type === 'done');
    assert.equal(doneEvent, undefined, 'Should not yield done event after abort');
  });
});

