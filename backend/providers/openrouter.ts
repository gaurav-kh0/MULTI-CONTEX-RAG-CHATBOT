/**
 * OpenRouter Provider Adapter
 *
 * Implements ILlmProviderAdapter using native fetch against OpenRouter's
 * documented OpenAI-compatible chat completions endpoint:
 * https://openrouter.ai/api/v1/chat/completions
 *
 * Authentication:
 * Authorization: Bearer <OPENROUTER_API_KEY>
 *
 * Optional Documented Headers:
 * HTTP-Referer: App URL
 * X-Title: App Title
 *
 * Credentials and model identifiers are read from server-side configuration.
 * Raw secret values are never exposed in error messages or response payloads.
 */

import type {
  ProviderId,
  LlmCompletionOptions,
  LlmCompletionResult,
} from '../../lib/types.ts';
import type {
  ILlmProviderAdapter,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderStreamChunk,
  ProviderUsage,
} from './types.ts';
import { normalizeProviderMessages } from './types.ts';
import {
  ProviderError,
  mapHttpStatusToErrorCode,
  sanitizeErrorMessage,
} from './errors.ts';
import { parseOpenAiSseStream } from './sse-parser.ts';

export interface OpenRouterConfig {
  apiKey?: string;
  defaultModel?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterProvider implements ILlmProviderAdapter {
  readonly id: ProviderId = 'openrouter';
  readonly name = 'OpenRouter';
  readonly defaultModel: string;

  private apiKey?: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(config?: OpenRouterConfig) {
    this.apiKey = config?.apiKey || process.env.OPENROUTER_API_KEY;
    this.defaultModel =
      config?.defaultModel || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
    this.baseUrl =
      config?.baseUrl || process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL;
    this.fetchFn = config?.fetchFn || globalThis.fetch.bind(globalThis);
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey || process.env.OPENROUTER_API_KEY);
  }

  supportsStreaming(): boolean {
    return true;
  }

  private getEffectiveApiKey(): string {
    const key = this.apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new ProviderError({
        providerId: this.id,
        code: 'CONFIGURATION_ERROR',
        message: 'OPENROUTER_API_KEY server environment variable is not configured.',
      });
    }
    return key;
  }

  private buildHeaders(apiKey: string): HeadersInit {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
      'X-Title': 'Multi-Context RAG Chatbot',
    };
  }

  private async handleErrorResponse(res: Response, apiKey: string): Promise<never> {
    const status = res.status;
    let rawErrorMessage = `OpenRouter API request failed with status ${status}`;

    try {
      const text = await res.text();
      if (text) {
        try {
          const errBody = JSON.parse(text);
          if (errBody?.error?.message) {
            rawErrorMessage = errBody.error.message;
          } else if (typeof errBody?.message === 'string') {
            rawErrorMessage = errBody.message;
          } else {
            rawErrorMessage = text;
          }
        } catch {
          rawErrorMessage = text;
        }
      }
    } catch {
      // Fallback to default message
    }

    const code = mapHttpStatusToErrorCode(status);
    const sanitized = sanitizeErrorMessage(rawErrorMessage, [apiKey]);

    throw new ProviderError({
      providerId: this.id,
      code,
      statusCode: status,
      message: sanitized,
    });
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const apiKey = this.getEffectiveApiKey();
    const { messages } = normalizeProviderMessages(this.id, request);
    const model = request.options?.model || this.defaultModel;

    const payload: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };

    if (typeof request.options?.temperature === 'number') {
      payload.temperature = request.options.temperature;
    }
    if (typeof request.options?.maxTokens === 'number') {
      payload.max_tokens = request.options.maxTokens;
    }
    if (typeof request.options?.topP === 'number') {
      payload.top_p = request.options.topP;
    }

    // Support documented OpenRouter-specific parameters
    if (request.options?.openrouter?.route) {
      payload.route = request.options.openrouter.route;
    }
    if (request.options?.openrouter?.transforms) {
      payload.transforms = request.options.openrouter.transforms;
    }
    if (request.options?.openrouter?.models) {
      payload.models = request.options.openrouter.models;
    }
    if (request.options?.openrouter?.providerRouting) {
      payload.provider = request.options.openrouter.providerRouting;
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    let response: Response;

    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        signal: request.options?.abortSignal,
      });
    } catch (networkErr) {
      const message = sanitizeErrorMessage(
        networkErr instanceof Error ? networkErr.message : String(networkErr),
        [apiKey]
      );
      throw new ProviderError({
        providerId: this.id,
        code: 'NETWORK_ERROR',
        message: `Failed to connect to OpenRouter endpoint: ${message}`,
        rawError: networkErr,
      });
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, apiKey);
    }

    let data: any;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new ProviderError({
        providerId: this.id,
        code: 'PARSE_ERROR',
        message: 'Failed to parse JSON response from OpenRouter API',
        rawError: parseErr,
      });
    }

    const content = data?.choices?.[0]?.message?.content ?? '';
    let usage: ProviderUsage | undefined;

    if (data?.usage) {
      usage = {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      };
    }

    return {
      content,
      providerId: this.id,
      model: data?.model || model,
      usage,
    };
  }

  async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    const apiKey = this.getEffectiveApiKey();
    const { messages } = normalizeProviderMessages(this.id, request);
    const model = request.options?.model || this.defaultModel;

    const payload: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (typeof request.options?.temperature === 'number') {
      payload.temperature = request.options.temperature;
    }
    if (typeof request.options?.maxTokens === 'number') {
      payload.max_tokens = request.options.maxTokens;
    }
    if (typeof request.options?.topP === 'number') {
      payload.top_p = request.options.topP;
    }

    if (request.options?.openrouter?.route) {
      payload.route = request.options.openrouter.route;
    }
    if (request.options?.openrouter?.transforms) {
      payload.transforms = request.options.openrouter.transforms;
    }
    if (request.options?.openrouter?.models) {
      payload.models = request.options.openrouter.models;
    }
    if (request.options?.openrouter?.providerRouting) {
      payload.provider = request.options.openrouter.providerRouting;
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    let response: Response;

    try {
      response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(apiKey),
        body: JSON.stringify(payload),
        signal: request.options?.abortSignal,
      });
    } catch (networkErr) {
      const message = sanitizeErrorMessage(
        networkErr instanceof Error ? networkErr.message : String(networkErr),
        [apiKey]
      );
      throw new ProviderError({
        providerId: this.id,
        code: 'NETWORK_ERROR',
        message: `Failed to connect to OpenRouter streaming endpoint: ${message}`,
        rawError: networkErr,
      });
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, apiKey);
    }

    let aggregatedUsage: ProviderUsage | undefined;

    try {
      for await (const chunk of parseOpenAiSseStream(response)) {
        if (chunk.json.usage) {
          aggregatedUsage = {
            promptTokens: chunk.json.usage.prompt_tokens ?? 0,
            completionTokens: chunk.json.usage.completion_tokens ?? 0,
            totalTokens: chunk.json.usage.total_tokens ?? 0,
          };
        }

        const delta = chunk.json.choices?.[0]?.delta?.content;
        if (delta && delta.length > 0) {
          yield {
            text: delta,
            done: false,
            providerId: this.id,
            model,
          };
        }
      }

      yield {
        text: '',
        done: true,
        providerId: this.id,
        model,
        usage: aggregatedUsage,
      };
    } catch (streamErr) {
      if (streamErr instanceof ProviderError) throw streamErr;
      const message = sanitizeErrorMessage(
        streamErr instanceof Error ? streamErr.message : String(streamErr),
        [apiKey]
      );
      throw new ProviderError({
        providerId: this.id,
        code: 'PARSE_ERROR',
        message: `Stream read error: ${message}`,
        rawError: streamErr,
      });
    }
  }

  async generateCompletion(
    prompt: string,
    options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult> {
    const result = await this.generateText({
      prompt,
      options: {
        model: options?.model,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        systemPrompt: options?.systemPrompt,
      },
    });

    return {
      content: result.content,
      usage: result.usage,
    };
  }
}
