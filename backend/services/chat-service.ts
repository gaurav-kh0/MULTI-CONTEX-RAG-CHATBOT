/**
 * Chat Service (Server-Only Orchestration Layer)
 *
 * Central orchestration for multi-context conversational workflows, session management,
 * prompt construction, provider routing, and LLM text generation.
 *
 * Strict Security & Integrity Constraints:
 * 1. Validates incoming message and context before invoking any model.
 * 2. Validates selected provider and requested model against server configuration.
 * 3. Enforces server-controlled system instructions (client cannot override).
 * 4. Limits historical messages to a configurable recent window to prevent unbounded context.
 * 5. Does not send secrets or unrelated internal data to external providers.
 * 6. Never fabricates an answer on provider failure.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponsePayload,
  ChatSession,
  ContextType,
  GroundingStatus,
  ProviderId,
  SourceReference,
  TokenUsage,
  UserChatMessage,
  AssistantChatMessage,
} from '../../lib/types.ts';
import {
  validateUserMessage,
  validateContextTypes,
  validateProviderId,
} from '../../lib/validation.ts';
import {
  providerRegistry,
  ProviderRegistry,
  ProviderError,
} from '../providers/index.ts';
import type { ILlmProviderAdapter, ProviderMessage } from '../providers/types.ts';
import type { ChatStreamEvent } from '../../lib/stream-protocol.ts';
import {
  RagPipeline,
  ragPipeline,
} from '../rag/rag-pipeline.ts';
import { documentService } from './document-service.ts';

export const DEFAULT_MAX_HISTORY_MESSAGES = 10;

export const DEFAULT_ALLOWED_MODELS: Record<ProviderId, string[]> = {
  gemini: ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct',
    'meta-llama/llama-3.1-8b-instruct',
    'anthropic/claude-3.5-haiku',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash-001',
  ],
  nvidia: [
    'meta/llama-3.3-70b-instruct',
    'mistralai/mistral-large-2-instruct',
    'nvidia/nemotron-4-340b-instruct',
  ],
  mock: ['mock-model-v1'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-3-5-sonnet', 'claude-3-5-haiku'],
  ollama: ['llama3', 'mistral'],
};

export { buildSystemInstruction } from '../rag/rag-pipeline.ts';

export interface ChatServiceConfig {
  registry?: ProviderRegistry;
  pipeline?: RagPipeline;
  maxHistoryMessages?: number;
  allowedModels?: Partial<Record<ProviderId, string[]>>;
  defaultProviderId?: ProviderId;
}

export class ChatService {
  private sessions: Map<string, ChatSession> = new Map();
  private registry: ProviderRegistry;
  private pipeline: RagPipeline;
  private maxHistoryMessages: number;
  private allowedModels: Record<ProviderId, string[]>;
  private defaultProviderId?: ProviderId;

  constructor(config?: ChatServiceConfig) {
    this.registry = config?.registry || providerRegistry;
    this.defaultProviderId =
      config?.defaultProviderId ||
      ((process.env.DEFAULT_LLM_PROVIDER as ProviderId) || 'gemini');

    this.pipeline =
      config?.pipeline ||
      new RagPipeline({
        registry: this.registry,
        defaultProviderId: this.defaultProviderId,
      });

    this.maxHistoryMessages =
      config?.maxHistoryMessages ??
      (process.env.CHAT_MAX_HISTORY_MESSAGES
        ? parseInt(process.env.CHAT_MAX_HISTORY_MESSAGES, 10)
        : DEFAULT_MAX_HISTORY_MESSAGES);

    // Seed allowed models with defaults plus any server env overrides
    this.allowedModels = {
      gemini: [
        ...DEFAULT_ALLOWED_MODELS.gemini,
        ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
      ],
      openrouter: [
        ...DEFAULT_ALLOWED_MODELS.openrouter,
        ...(process.env.OPENROUTER_MODEL ? [process.env.OPENROUTER_MODEL] : []),
      ],
      nvidia: [
        ...DEFAULT_ALLOWED_MODELS.nvidia,
        ...(process.env.NVIDIA_MODEL ? [process.env.NVIDIA_MODEL] : []),
      ],
      mock: [...DEFAULT_ALLOWED_MODELS.mock],
      openai: [...DEFAULT_ALLOWED_MODELS.openai],
      anthropic: [...DEFAULT_ALLOWED_MODELS.anthropic],
      ollama: [...DEFAULT_ALLOWED_MODELS.ollama],
      ...(config?.allowedModels || {}),
    };

    this.seedInitialSession();
  }

  getPipeline(): RagPipeline {
    return this.pipeline;
  }

  private seedInitialSession(): void {
    const demoSessionId = 'session_initial_workspace';
    this.sessions.set(demoSessionId, {
      id: demoSessionId,
      title: 'Initial Workspace Chat',
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      activeContexts: ['NEC', 'WATTMONK'],
      messages: [
        {
          id: 'msg_welcome_user',
          role: 'user',
          content: 'Hello, what contexts are available in this assistant?',
          timestamp: new Date(Date.now() - 300000).toISOString(),
          contexts: ['NEC', 'WATTMONK'],
        },
        {
          id: 'msg_welcome_assistant',
          role: 'assistant',
          content:
            'Welcome! Available partitioned contexts are NEC (National Electrical Code), Wattmonk / Solar PV, and General Engineering.\n\nYou can select contexts using the selector above and submit queries.',
          timestamp: new Date(Date.now() - 290000).toISOString(),
          contexts: ['NEC', 'WATTMONK'],
          references: [],
          citations: [],
        },
      ],
      createdAt: new Date(Date.now() - 300000).toISOString(),
      updatedAt: new Date(Date.now() - 290000).toISOString(),
    });
  }

  async listSessions(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getSession(id: string): Promise<ChatSession | null> {
    return this.sessions.get(id) || null;
  }

  async createSession(title = 'New Multi-Context Chat'): Promise<ChatSession> {
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      activeContexts: ['NEC', 'WATTMONK'],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  /**
   * Validates incoming request parameters and contexts.
   */
  private validateInputs(request: ChatRequest): {
    message: string;
    contexts: ContextType[];
  } {
    const messageValidation = validateUserMessage(request.message);
    if (!messageValidation.valid) {
      throw new ProviderError({
        providerId: request.providerId || 'gemini',
        code: 'INVALID_REQUEST',
        message: messageValidation.error,
      });
    }

    let resolvedContexts: ContextType[] = ['GENERAL'];
    if (request.contexts && request.contexts.length > 0) {
      const contextValidation = validateContextTypes(request.contexts, { allowEmpty: false });
      if (!contextValidation.valid) {
        throw new ProviderError({
          providerId: request.providerId || 'gemini',
          code: 'INVALID_REQUEST',
          message: contextValidation.error,
        });
      }
      resolvedContexts = contextValidation.value;
    } else if (request.activeContextScopeIds && request.activeContextScopeIds.length > 0) {
      const scopeToContextMap: Record<string, ContextType> = {
        scope_nec: 'NEC',
        scope_solar: 'WATTMONK',
        scope_general: 'GENERAL',
      };
      const mapped = new Set<ContextType>();
      for (const id of request.activeContextScopeIds) {
        if (scopeToContextMap[id]) {
          mapped.add(scopeToContextMap[id]);
        } else if (id.toLowerCase().includes('nec')) {
          mapped.add('NEC');
        } else if (id.toLowerCase().includes('solar') || id.toLowerCase().includes('wattmonk')) {
          mapped.add('WATTMONK');
        } else {
          mapped.add('GENERAL');
        }
      }
      if (mapped.size > 0) {
        resolvedContexts = Array.from(mapped);
      }
    }

    return {
      message: messageValidation.value,
      contexts: resolvedContexts,
    };
  }

  /**
   * Resolves the provider adapter and validates requested model against server configuration.
   */
  private resolveProviderAndModel(
    requestedProviderId?: ProviderId,
    requestedModel?: string
  ): { provider: ILlmProviderAdapter; model: string } {
    let effectiveProviderId: ProviderId;

    if (requestedProviderId) {
      const validation = validateProviderId(requestedProviderId);
      if (!validation.valid) {
        throw new ProviderError({
          providerId: 'mock',
          code: 'INVALID_REQUEST',
          message: validation.error,
        });
      }
      effectiveProviderId = validation.value;
    } else {
      effectiveProviderId = this.defaultProviderId || 'gemini';
    }

    // Resolves provider; throws CONFIGURATION_ERROR if unconfigured
    const provider = this.registry.getProvider(effectiveProviderId);

    // Validate requested model if supplied
    let effectiveModel = provider.defaultModel;
    if (requestedModel) {
      const trimmedModel = requestedModel.trim();
      const allowed = this.allowedModels[effectiveProviderId] || [];

      if (allowed.length > 0 && !allowed.includes(trimmedModel)) {
        throw new ProviderError({
          providerId: effectiveProviderId,
          code: 'INVALID_REQUEST',
          message: `Model '${trimmedModel}' is not allowed for provider '${effectiveProviderId}'. Allowed models: [${allowed.join(', ')}].`,
        });
      }
      effectiveModel = trimmedModel;
    }

    return { provider, model: effectiveModel };
  }

  /**
   * Constructs bounded conversation history for LLM generation.
   * Excludes older messages beyond maxHistoryMessages window to prevent unbounded context.
   */
  private buildHistoryWindow(
    session: ChatSession,
    newUserMessage?: string
  ): ProviderMessage[] {
    const historicalMessages = session.messages || [];

    // Slice only the most recent N messages
    const recentHistory = historicalMessages.slice(-this.maxHistoryMessages);

    const normalized: ProviderMessage[] = [];
    for (const msg of recentHistory) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        normalized.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Append user message if provided
    if (newUserMessage) {
      normalized.push({
        role: 'user',
        content: newUserMessage,
      });
    }

    return normalized;
  }

  /**
   * Central orchestration for chat message generation.
   */
  async processMessage(request: ChatRequest): Promise<ChatResponsePayload> {
    // 1. Validate incoming message and context
    const { message, contexts } = this.validateInputs(request);

    // If a specific document is targeted, ensure its context is included in contexts
    if (request.documentId && request.documentId.trim()) {
      try {
        const targetDoc = await documentService.getDocument(request.documentId.trim());
        const docContext = (targetDoc?.metadata?.contextType || targetDoc?.metadata?.context) as ContextType | undefined;
        if (docContext && !contexts.includes(docContext)) {
          contexts.push(docContext);
        }
      } catch {
        // Continue if document lookup fails
      }
    }

    // 2. Validate selected provider and model against server configuration
    const { provider, model } = this.resolveProviderAndModel(
      request.providerId,
      request.model
    );

    // 3. Resolve or initialize session
    let session: ChatSession | undefined;
    if (request.sessionId) {
      session = this.sessions.get(request.sessionId);
    }

    if (!session) {
      const generatedTitle =
        message.length > 40 ? `${message.slice(0, 40)}...` : message;
      session = await this.createSession(generatedTitle);
    } else if (session.messages.length === 0) {
      session.title =
        message.length > 40 ? `${message.slice(0, 40)}...` : message;
    }

    session.activeContexts = contexts;

    // 4. Build bounded prior history window (excluding current user message, which pipeline appends)
    const historyMessages = this.buildHistoryWindow(session);

    // 5. Execute RAG pipeline (validates, retrieves untrusted evidence, constructs bounded prompt, calls provider)
    let ragResult;
    try {
      ragResult = await this.pipeline.execute({
        message,
        contexts,
        autoDetectContext: request.autoDetectContext,
        documentOnly: request.documentOnly,
        topK: request.topK,
        minScoreThreshold: request.minScoreThreshold,
        documentId: request.documentId,
        provider,
        model,
        historyMessages,
      });
    } catch (pipelineError) {
      // Re-throw provider / pipeline error upstream without fabricating responses or saving broken state
      throw pipelineError;
    }

    const effectiveContexts = ragResult.context;
    session.activeContexts = effectiveContexts;

    // 6. Construct typed user and assistant messages
    const userMessage: UserChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      contexts: effectiveContexts,
      contextScopeIds: request.activeContextScopeIds,
    };

    const assistantMessage: AssistantChatMessage = {
      id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'assistant',
      content: ragResult.answer,
      timestamp: new Date().toISOString(),
      contexts: effectiveContexts,
      contextScopeIds: request.activeContextScopeIds,
      providerId: ragResult.providerId,
      usage: ragResult.usage,
      groundingStatus: ragResult.groundingStatus,
      detectedContexts: ragResult.detectedContexts,
      references: ragResult.references,
      citations: ragResult.citations,
    };

    // 7. Persist messages to session
    session.messages.push(userMessage);
    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();

    return {
      sessionId: session.id,
      userMessage,
      assistantMessage,
      references: ragResult.references,
      citations: ragResult.citations,
      groundingStatus: ragResult.groundingStatus,
      detectedContexts: ragResult.detectedContexts,
      session,
    };
  }

  /**
   * Progressive streaming orchestration for chat message generation.
   * Yields typed ChatStreamEvents (session, delta, done, non_streaming).
   */
  async *streamMessage(
    request: ChatRequest,
    options?: { signal?: AbortSignal }
  ): AsyncIterable<ChatStreamEvent> {
    // 1. Validate incoming message and context
    const { message, contexts } = this.validateInputs(request);

    // If a specific document is targeted, ensure its context is included in contexts
    if (request.documentId && request.documentId.trim()) {
      try {
        const targetDoc = await documentService.getDocument(request.documentId.trim());
        const docContext = (targetDoc?.metadata?.contextType || targetDoc?.metadata?.context) as ContextType | undefined;
        if (docContext && !contexts.includes(docContext)) {
          contexts.push(docContext);
        }
      } catch {
        // Continue if document lookup fails
      }
    }

    // 2. Validate selected provider and model against server configuration
    const { provider, model } = this.resolveProviderAndModel(
      request.providerId,
      request.model
    );

    // 3. Fallback: If provider adapter explicitly indicates no streaming support,
    // return clearly handled non-streaming response instead of pretending to stream.
    if (provider.supportsStreaming && !provider.supportsStreaming()) {
      const nonStreamingResult = await this.processMessage(request);
      yield {
        type: 'non_streaming',
        data: nonStreamingResult,
      };
      return;
    }

    // 4. Resolve or initialize session
    let session: ChatSession | undefined;
    if (request.sessionId) {
      session = this.sessions.get(request.sessionId);
    }

    if (!session) {
      const generatedTitle =
        message.length > 40 ? `${message.slice(0, 40)}...` : message;
      session = await this.createSession(generatedTitle);
    } else if (session.messages.length === 0) {
      session.title =
        message.length > 40 ? `${message.slice(0, 40)}...` : message;
    }

    session.activeContexts = contexts;

    // Create user message and append to session
    const userMessage: UserChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      contexts,
      contextScopeIds: request.activeContextScopeIds,
    };
    session.messages.push(userMessage);

    // Initial event alerting the client about session and user message
    yield {
      type: 'session',
      data: {
        sessionId: session.id,
        userMessage,
        session,
      },
    };

    // 5. Build bounded prior history window
    const priorHistory = session.messages
      .slice(0, -1)
      .slice(-this.maxHistoryMessages)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      const stream = this.pipeline.executeStream({
        message,
        contexts,
        autoDetectContext: request.autoDetectContext,
        documentOnly: request.documentOnly,
        topK: request.topK,
        minScoreThreshold: request.minScoreThreshold,
        documentId: request.documentId,
        provider,
        model,
        historyMessages: priorHistory,
        signal: options?.signal,
      });

      let finalAnswer = '';
      let finalCitations: SourceReference[] = [];
      let finalReferences: SourceReference[] = [];
      let finalGroundingStatus: GroundingStatus = 'not_grounded';
      let finalUsage: TokenUsage | undefined;
      let effectiveContexts = contexts;
      let detectedContexts: ContextType[] | undefined;

      for await (const chunk of stream) {
        if (options?.signal?.aborted) {
          return;
        }

        if (chunk.type === 'chunk') {
          if (chunk.text && chunk.text.length > 0) {
            yield {
              type: 'delta',
              data: {
                text: chunk.text,
                providerId: chunk.providerId,
                model: chunk.model,
              },
            };
          }
        } else if (chunk.type === 'done') {
          finalAnswer = chunk.answer;
          finalCitations = chunk.citations;
          finalReferences = chunk.references;
          finalGroundingStatus = chunk.groundingStatus;
          finalUsage = chunk.usage;
          effectiveContexts = chunk.context;
          detectedContexts = chunk.detectedContexts;
        }
      }

      if (options?.signal?.aborted) {
        return;
      }

      // Update contexts on user message and session
      userMessage.contexts = effectiveContexts;
      session.activeContexts = effectiveContexts;

      // 6. Finalize assistant message and persist to session
      const assistantMessage: AssistantChatMessage = {
        id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: 'assistant',
        content: finalAnswer,
        timestamp: new Date().toISOString(),
        contexts: effectiveContexts,
        contextScopeIds: request.activeContextScopeIds,
        providerId: provider.id,
        usage: finalUsage,
        groundingStatus: finalGroundingStatus,
        detectedContexts,
        references: finalReferences,
        citations: finalCitations,
      };

      session.messages.push(assistantMessage);
      session.updatedAt = new Date().toISOString();

      yield {
        type: 'done',
        data: {
          sessionId: session.id,
          assistantMessage,
          session,
          groundingStatus: finalGroundingStatus,
          references: finalReferences,
          citations: finalCitations,
        },
      };
    } catch (providerError) {
      // Re-throw provider failure upstream without fabricating answers or saving corrupted assistant state
      throw providerError;
    }
  }
}

const globalForChatService = globalThis as unknown as {
  chatService?: ChatService;
};

export const chatService =
  globalForChatService.chatService ?? new ChatService();

globalForChatService.chatService = chatService;
