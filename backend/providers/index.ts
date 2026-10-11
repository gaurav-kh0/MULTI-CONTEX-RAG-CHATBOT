/**
 * AI Providers Module
 *
 * Exports unified LLM provider adapters, registry, streaming parsers, and error types.
 */

import type { EmbeddingProviderType, IEmbeddingProvider } from '../../lib/types.ts';
import { MockProvider } from './mock-provider.ts';

// 1. Errors & Status Mapping
export { ProviderError, mapHttpStatusToErrorCode } from './errors.ts';
export type { ProviderErrorCode, ProviderErrorOptions } from './errors.ts';

// 2. Types & Request/Response Contracts
export { normalizeProviderMessages } from './types.ts';
export type {
  ILlmProviderAdapter,
  ProviderMessage,
  ProviderMessageRole,
  ProviderGenerateOptions,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderStreamChunk,
  ProviderUsage,
} from './types.ts';

// 3. Streaming Utilities
export { parseOpenAiSseStream } from './sse-parser.ts';
export type {
  OpenAiStreamChunk,
  OpenAiStreamChoice,
  OpenAiStreamDelta,
} from './sse-parser.ts';

// 4. Provider Adapters
export { GeminiProvider, DEFAULT_GEMINI_MODEL } from './gemini-provider.ts';
export type { GeminiProviderConfig } from './gemini-provider.ts';

export {
  OpenRouterProvider,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_BASE_URL,
} from './openrouter.ts';
export type { OpenRouterConfig, OpenRouterConfig as OpenRouterProviderConfig } from './openrouter.ts';

export {
  NvidiaProvider,
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_NVIDIA_BASE_URL,
} from './nvidia.ts';
export type { NvidiaConfig, NvidiaConfig as NvidiaProviderConfig } from './nvidia.ts';

export { MockProvider } from './mock-provider.ts';

// 5. Registry & Resolution
export { ProviderRegistry, providerRegistry, getLlmProvider } from './registry.ts';

// 6. Embedding Provider (Stub for future vector phases)
export class StubEmbeddingProvider implements IEmbeddingProvider {
  id: EmbeddingProviderType = 'mock';
  name = 'Stub Embedding Provider';

  async generateEmbedding(_text: string): Promise<number[]> {
    return new Array(1536).fill(0);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(1536).fill(0));
  }
}

// 7. Defaults for backward compatibility
export const defaultLlmProvider = new MockProvider();
export const defaultEmbeddingProvider = new StubEmbeddingProvider();
