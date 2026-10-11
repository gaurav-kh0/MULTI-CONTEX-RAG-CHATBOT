/**
 * Mock LLM Provider Adapter
 *
 * Implements ILlmProviderAdapter for offline development, deterministic testing,
 * and zero-credential environments.
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
} from './types.ts';
import { normalizeProviderMessages } from './types.ts';

export class MockProvider implements ILlmProviderAdapter {
  readonly id: ProviderId = 'mock';
  readonly name = 'Mock Provider';
  readonly defaultModel = 'mock-model-v1';

  isConfigured(): boolean {
    return true;
  }

  supportsStreaming(): boolean {
    return true;
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const { messages } = normalizeProviderMessages(this.id, request);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const model = request.options?.model || this.defaultModel;

    const content = `[Mock Response] Handled query: "${lastUserMessage.slice(0, 50)}"`;

    return {
      content,
      providerId: this.id,
      model,
      usage: {
        promptTokens: Math.ceil(lastUserMessage.length / 4),
        completionTokens: Math.ceil(content.length / 4),
        totalTokens: Math.ceil((lastUserMessage.length + content.length) / 4),
      },
    };
  }

  async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    const { messages } = normalizeProviderMessages(this.id, request);
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const model = request.options?.model || this.defaultModel;

    const words = [
      '[Mock',
      'Stream]',
      'Handled',
      `"${lastUserMessage.slice(0, 30)}"`,
      'successfully.',
    ];

    for (const word of words) {
      yield {
        text: `${word} `,
        done: false,
        providerId: this.id,
        model,
      };
    }

    yield {
      text: '',
      done: true,
      providerId: this.id,
      model,
      usage: {
        promptTokens: 10,
        completionTokens: words.length * 2,
        totalTokens: 10 + words.length * 2,
      },
    };
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
