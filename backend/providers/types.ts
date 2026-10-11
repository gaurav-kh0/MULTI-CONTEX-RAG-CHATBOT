/**
 * AI Provider Types & Interfaces
 *
 * Defines strongly-typed contracts for LLM text generation, streaming,
 * token accounting, and provider adapters across Gemini, OpenRouter, NVIDIA, and Mock.
 */

import type {
  ProviderId,
  ILlmProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
} from '../../lib/types.ts';
import { ProviderError } from './errors.ts';

export type ProviderMessageRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
}

export interface OpenRouterSpecificOptions {
  route?: 'fallback';
  transforms?: string[];
  models?: string[];
  providerRouting?: {
    order?: string[];
    allow_fallbacks?: boolean;
    data_collection?: 'deny' | 'allow';
  };
}

export interface NvidiaSpecificOptions {
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
}

export interface ProviderGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  systemPrompt?: string;
  abortSignal?: AbortSignal;
  /** Documented OpenRouter-specific routing & fallback parameters */
  openrouter?: OpenRouterSpecificOptions;
  /** Documented NVIDIA NIM generation parameters */
  nvidia?: NvidiaSpecificOptions;
}

export interface ProviderGenerateRequest {
  /** Array of conversational messages (system, user, assistant) */
  messages?: ProviderMessage[];
  /** Single string prompt (convenience shorthand for a single user message) */
  prompt?: string;
  /** LLM generation hyperparameters and control flags */
  options?: ProviderGenerateOptions;
}

export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderGenerateResult {
  content: string;
  providerId: ProviderId;
  model: string;
  usage?: ProviderUsage;
  raw?: unknown;
}

export interface ProviderStreamChunk {
  /** Incremental token/text delta produced in this chunk */
  text: string;
  /** Whether this chunk signifies completion of the stream */
  done: boolean;
  /** Identifier of the provider generating this stream */
  providerId: ProviderId;
  /** Specific model identifier utilized for generation */
  model: string;
  /** Cumulative token usage, typically populated on the final chunk if supported */
  usage?: ProviderUsage;
}

/**
 * Common adapter contract that all concrete LLM providers must implement.
 * Extends ILlmProvider for full backward compatibility with the domain contract.
 */
export interface ILlmProviderAdapter extends ILlmProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly defaultModel: string;

  /**
   * Checks whether the provider adapter has required credentials configured.
   */
  isConfigured(): boolean;

  /**
   * Indicates whether the provider adapter supports native token streaming.
   * Defaults to true if not defined.
   */
  supportsStreaming?(): boolean;

  /**
   * Executes non-streaming LLM text generation.
   */
  generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult>;

  /**
   * Executes streaming LLM text generation, yielding tokens/deltas as they arrive.
   */
  streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk>;

  /**
   * Legacy single-prompt completion method matching ILlmProvider.
   */
  generateCompletion(
    prompt: string,
    options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult>;
}

/**
 * Normalizes request inputs into a unified array of ProviderMessage objects.
 * Throws a ProviderError(INVALID_REQUEST) if no content is provided.
 */
export function normalizeProviderMessages(
  providerId: ProviderId,
  request: ProviderGenerateRequest
): { messages: ProviderMessage[]; systemPrompt?: string } {
  const result: ProviderMessage[] = [];
  const systemPrompt = request.options?.systemPrompt?.trim();

  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }

  if (request.messages && request.messages.length > 0) {
    for (const msg of request.messages) {
      if (!msg.content || typeof msg.content !== 'string') continue;
      // If we already added system prompt and the incoming messages also have system prompt, preserve
      result.push({
        role: msg.role,
        content: msg.content.trim(),
      });
    }
  } else if (request.prompt && typeof request.prompt === 'string') {
    const trimmed = request.prompt.trim();
    if (trimmed.length > 0) {
      result.push({ role: 'user', content: trimmed });
    }
  }

  if (result.length === 0) {
    throw new ProviderError({
      providerId,
      code: 'INVALID_REQUEST',
      message: 'Provider generation request must include at least one non-empty message or prompt.',
    });
  }

  return { messages: result, systemPrompt };
}
