/**
 * AI Providers Module
 *
 * Exports unified LLM provider adapters, registry, streaming parsers, and error types.
 */
// 1. Errors & Status Mapping
export { ProviderError, mapHttpStatusToErrorCode, mapProviderErrorToHttpStatus, sanitizeErrorMessage } from './errors.ts';
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
