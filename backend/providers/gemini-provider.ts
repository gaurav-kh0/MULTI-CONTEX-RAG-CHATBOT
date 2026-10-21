/**
 * Google Gemini Provider Adapter
 *
 * Implements ILlmProviderAdapter using the official `@google/genai` SDK.
 * Reads GEMINI_API_KEY from server environment variables.
 *
 * Supports non-streaming and streaming generation, prompt/message formatting,
 * token accounting, and standardized error translation.
 */

import { GoogleGenAI } from '@google/genai';
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
import { ProviderError, mapHttpStatusToErrorCode } from './errors.ts';
import type { ProviderErrorCode } from './errors.ts';

export interface GeminiProviderConfig {
  apiKey?: string;
  defaultModel?: string;
  client?: GoogleGenAI;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export class GeminiProvider implements ILlmProviderAdapter {
  readonly id: ProviderId = 'gemini';
  readonly name = 'Google Gemini';
  readonly defaultModel: string;

  private apiKey?: string;
  private client?: GoogleGenAI;

  constructor(config?: GeminiProviderConfig) {
    this.apiKey = config?.apiKey || process.env.GEMINI_API_KEY;
    this.defaultModel = config?.defaultModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

    if (config?.client) {
      this.client = config.client;
    } else if (this.apiKey) {
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.client || this.apiKey);
  }

  supportsStreaming(): boolean {
    return true;
  }

  private ensureClient(): GoogleGenAI {
    if (this.client) {
      return this.client;
    }

    const key = this.apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new ProviderError({
        providerId: this.id,
        code: 'CONFIGURATION_ERROR',
        message: 'GEMINI_API_KEY environment variable is not configured.',
      });
    }

    this.apiKey = key;
    this.client = new GoogleGenAI({ apiKey: key });
    return this.client;
  }

  private mapError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const anyErr = error as {
      status?: number;
      statusCode?: number;
      message?: string;
      code?: number;
    };

    const status = anyErr?.status || anyErr?.statusCode || anyErr?.code;
    const statusCode = typeof status === 'number' ? status : undefined;
    const message = anyErr?.message || String(error);

    let code: ProviderErrorCode = statusCode
      ? mapHttpStatusToErrorCode(statusCode)
      : 'NETWORK_ERROR';

    if (
      message.includes('API key not valid') ||
      message.includes('API_KEY_INVALID') ||
      statusCode === 401
    ) {
      code = 'AUTHENTICATION_ERROR';
    } else if (message.includes('Resource has been exhausted') || statusCode === 429) {
      code = 'RATE_LIMIT_ERROR';
    } else if (message.includes('not found') || statusCode === 404) {
      code = 'MODEL_NOT_FOUND';
    }

    return new ProviderError({
      providerId: this.id,
      code,
      statusCode,
      message,
      rawError: error,
    });
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const client = this.ensureClient();
    const { messages, systemPrompt } = normalizeProviderMessages(this.id, request);
    const model = request.options?.model || this.defaultModel;

    // Filter conversational contents (system instructions go into generation config)
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // Fallback if only a system prompt was supplied
    if (contents.length === 0 && systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      });
    }

    const config: Record<string, unknown> = {};
    if (systemPrompt) {
      config.systemInstruction = systemPrompt;
    }
    if (typeof request.options?.temperature === 'number') {
      config.temperature = request.options.temperature;
    }
    if (typeof request.options?.maxTokens === 'number') {
      config.maxOutputTokens = request.options.maxTokens;
    }
    if (typeof request.options?.topP === 'number') {
      config.topP = request.options.topP;
    }

    let activeModel = model;
    const fallbackModel = activeModel === 'gemini-3.5-flash' ? 'gemini-3.8-flash' : 'gemini-3.5-flash';
    let response;
    try {
      response = await client.models.generateContent({
        model: activeModel,
        contents,
        config,
      });
    } catch (firstErr: unknown) {
      const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const isRetriable =
        errMsg.includes('404') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.includes('no longer available') ||
        errMsg.includes('503') ||
        errMsg.includes('high demand') ||
        errMsg.includes('UNAVAILABLE');

      if (isRetriable && activeModel !== fallbackModel) {
        activeModel = fallbackModel;
        try {
          response = await client.models.generateContent({
            model: activeModel,
            contents,
            config,
          });
        } catch (retryErr) {
          throw this.mapError(retryErr);
        }
      } else {
        throw this.mapError(firstErr);
      }
    }

    const content = response.text ?? '';
    let usage: ProviderUsage | undefined;

    if (response.usageMetadata) {
      usage = {
        promptTokens: response.usageMetadata.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata.totalTokenCount ?? 0,
      };
    }

    return {
      content,
      providerId: this.id,
      model: activeModel,
      usage,
      raw: response,
    };
  }

  async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    const client = this.ensureClient();
    const { messages, systemPrompt } = normalizeProviderMessages(this.id, request);
    const model = request.options?.model || this.defaultModel;

    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    if (contents.length === 0 && systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: systemPrompt }],
      });
    }

    const config: Record<string, unknown> = {};
    if (systemPrompt) {
      config.systemInstruction = systemPrompt;
    }
    if (typeof request.options?.temperature === 'number') {
      config.temperature = request.options.temperature;
    }
    if (typeof request.options?.maxTokens === 'number') {
      config.maxOutputTokens = request.options.maxTokens;
    }
    if (typeof request.options?.topP === 'number') {
      config.topP = request.options.topP;
    }

    let activeModel = model;
    const fallbackModel = activeModel === 'gemini-3.5-flash' ? 'gemini-3.8-flash' : 'gemini-3.5-flash';
    let responseStream;
    try {
      responseStream = await client.models.generateContentStream({
        model: activeModel,
        contents,
        config,
      });
    } catch (firstErr: unknown) {
      const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      const isRetriable =
        errMsg.includes('404') ||
        errMsg.toLowerCase().includes('not found') ||
        errMsg.includes('no longer available') ||
        errMsg.includes('503') ||
        errMsg.includes('high demand') ||
        errMsg.includes('UNAVAILABLE');

      if (isRetriable && activeModel !== fallbackModel) {
        activeModel = fallbackModel;
        try {
          responseStream = await client.models.generateContentStream({
            model: activeModel,
            contents,
            config,
          });
        } catch (retryErr) {
          throw this.mapError(retryErr);
        }
      } else {
        throw this.mapError(firstErr);
      }
    }

    let aggregatedUsage: ProviderUsage | undefined;

    try {
      for await (const chunk of responseStream) {
        if (request.options?.abortSignal?.aborted) {
          return;
        }

        if (chunk.usageMetadata) {
          aggregatedUsage = {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
        }

        const chunkText = chunk.text ?? '';
        if (chunkText.length > 0) {
          yield {
            text: chunkText,
            done: false,
            providerId: this.id,
            model: activeModel,
          };
        }
      }

      // Final completion chunk
      yield {
        text: '',
        done: true,
        providerId: this.id,
        model: activeModel,
        usage: aggregatedUsage,
      };
    } catch (error) {
      throw this.mapError(error);
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
