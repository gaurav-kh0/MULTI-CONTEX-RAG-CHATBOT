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
  ProviderId,
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

export const DEFAULT_MAX_HISTORY_MESSAGES = 10;

export const DEFAULT_ALLOWED_MODELS: Record<ProviderId, string[]> = {
  gemini: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
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

/**
 * Builds server-controlled domain system instructions based on the active context partition(s).
 * Clients are strictly prevented from overriding this prompt.
 */
export function buildSystemInstruction(contexts: ContextType[]): string {
  const instructions: string[] = [];

  if (contexts.includes('NEC')) {
    instructions.push(
      'You are a specialized National Electrical Code (NEC) technical advisor. Provide accurate, code-compliant electrical engineering guidance adhering strictly to NFPA 70 / NEC standards (including Articles 690, 705, and 220). Emphasize electrical safety, equipment ratings, conductor sizing, and rapid shutdown compliance.'
    );
  }

  if (contexts.includes('WATTMONK')) {
    instructions.push(
      'You are an expert Solar PV engineering and plan-set specialist for Wattmonk. Provide accurate technical guidance on residential and commercial PV system layout, AHJ permitting, utility interconnection, equipment specification, and plan-set drafting checklists.'
    );
  }

  if (contexts.includes('GENERAL') || instructions.length === 0) {
    instructions.push(
      'You are an engineering AI assistant specializing in electrical, solar PV, and technical design. Provide clear, rigorous, and professional engineering insights.'
    );
  }

  return instructions.join('\n\n');
}

export interface ChatServiceConfig {
  registry?: ProviderRegistry;
  maxHistoryMessages?: number;
  allowedModels?: Partial<Record<ProviderId, string[]>>;
  defaultProviderId?: ProviderId;
}

export class ChatService {
  private sessions: Map<string, ChatSession> = new Map();
  private registry: ProviderRegistry;
  private maxHistoryMessages: number;
  private allowedModels: Record<ProviderId, string[]>;
  private defaultProviderId?: ProviderId;

  constructor(config?: ChatServiceConfig) {
    this.registry = config?.registry || providerRegistry;
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

    this.defaultProviderId =
      config?.defaultProviderId ||
      ((process.env.DEFAULT_LLM_PROVIDER as ProviderId) || 'gemini');

    this.seedInitialSession();
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
    newUserMessage: string
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

    // Append the current user message
    normalized.push({
      role: 'user',
      content: newUserMessage,
    });

    return normalized;
  }

  /**
   * Central orchestration for chat message generation.
   */
  async processMessage(request: ChatRequest): Promise<ChatResponsePayload> {
    // 1. Validate incoming message and context
    const { message, contexts } = this.validateInputs(request);

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

    // 4. Build trusted system instruction and bounded message history
    const systemPrompt = buildSystemInstruction(contexts);
    const messages = this.buildHistoryWindow(session, message);

    // 5. Call selected provider (does not fabricate an answer on failure)
    let result;
    try {
      result = await provider.generateText({
        messages,
        options: {
          model,
          systemPrompt,
        },
      });
    } catch (providerError) {
      // Re-throw provider error upstream without fabricating responses or saving broken state
      throw providerError;
    }

    // 6. Construct typed user and assistant messages
    const userMessage: UserChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      contexts,
      contextScopeIds: request.activeContextScopeIds,
    };

    const assistantMessage: AssistantChatMessage = {
      id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'assistant',
      content: result.content,
      timestamp: new Date().toISOString(),
      contexts,
      contextScopeIds: request.activeContextScopeIds,
      providerId: result.providerId,
      usage: result.usage,
      references: [],
      citations: [],
    };

    // 7. Persist messages to session
    session.messages.push(userMessage);
    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();

    return {
      sessionId: session.id,
      userMessage,
      assistantMessage,
      references: [],
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

    // 5. Build trusted system instruction and bounded message history
    const systemPrompt = buildSystemInstruction(contexts);
    const messages = this.buildHistoryWindow(session, message);

    let accumulatedText = '';
    let finalUsage = undefined;

    try {
      const stream = provider.streamText({
        messages,
        options: {
          model,
          systemPrompt,
          abortSignal: options?.signal,
        },
      });

      for await (const chunk of stream) {
        if (options?.signal?.aborted) {
          return;
        }

        if (chunk.usage) {
          finalUsage = chunk.usage;
        }

        if (chunk.text && chunk.text.length > 0) {
          accumulatedText += chunk.text;
          yield {
            type: 'delta',
            data: {
              text: chunk.text,
              providerId: chunk.providerId,
              model: chunk.model,
            },
          };
        }
      }

      if (options?.signal?.aborted) {
        return;
      }

      // 6. Finalize assistant message and persist to session
      const assistantMessage: AssistantChatMessage = {
        id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: 'assistant',
        content: accumulatedText,
        timestamp: new Date().toISOString(),
        contexts,
        contextScopeIds: request.activeContextScopeIds,
        providerId: provider.id,
        usage: finalUsage,
        references: [],
        citations: [],
      };

      session.messages.push(assistantMessage);
      session.updatedAt = new Date().toISOString();

      yield {
        type: 'done',
        data: {
          sessionId: session.id,
          assistantMessage,
          session,
        },
      };
    } catch (providerError) {
      // Re-throw provider failure upstream without fabricating answers or saving corrupted assistant state
      throw providerError;
    }
  }
}

export const chatService = new ChatService();
