import {
  ILlmProvider,
  IEmbeddingProvider,
  LlmCompletionOptions,
  LlmCompletionResult,
  LlmProviderType,
  EmbeddingProviderType,
} from '@/lib/types';

/**
 * Placeholder / Stub LLM Provider
 * In future phases, real providers (OpenAI, Anthropic, Ollama) will implement ILlmProvider.
 */
export class StubLlmProvider implements ILlmProvider {
  id: LlmProviderType = 'mock';
  name = 'Stub LLM Provider';

  async generateCompletion(
    prompt: string,
    _options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult> {
    return {
      content: `[Architecture Stub Response] Processed query against selected context. Length: ${prompt.length} chars.`,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }
}

/**
 * Placeholder / Stub Embedding Provider
 * In future phases, real embedding providers will implement IEmbeddingProvider.
 */
export class StubEmbeddingProvider implements IEmbeddingProvider {
  id: EmbeddingProviderType = 'mock';
  name = 'Stub Embedding Provider';

  async generateEmbedding(_text: string): Promise<number[]> {
    // Structural stub: returns a fixed mock dimension vector
    return new Array(1536).fill(0);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }
}

export const defaultLlmProvider = new StubLlmProvider();
export const defaultEmbeddingProvider = new StubEmbeddingProvider();
