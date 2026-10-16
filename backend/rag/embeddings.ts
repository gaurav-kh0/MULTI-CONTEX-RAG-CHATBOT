/**
 * Embeddings Module (RAG Ingestion & Query Vector Generation)
 *
 * Implements typed, validated embedding generation for document chunks and user queries.
 *
 * Model Selection & Specification:
 * - Provider: Google Gemini (via official @google/genai SDK)
 * - Model: text-embedding-004 (Official documented Google Gen AI embedding model)
 * - Dimensions: 768 (strictly fixed; both documents and queries share the identical vector space)
 * - Task Types:
 *     - RETRIEVAL_DOCUMENT: Used for indexing corpus chunks (optimizes document representation)
 *     - RETRIEVAL_QUERY: Used for user search questions (optimizes query similarity representation)
 * - Max Batch Limit: 100 inputs per request (enforced via automatic batch windowing)
 * - Max Input Limit: 8,000 characters per item (~2,000 tokens)
 *
 * Decoupling & Security:
 * - Completely separate from LLM chat generation providers.
 * - Server-side only; reads GEMINI_API_KEY / EMBEDDING_API_KEY from server environment.
 * - Rejects empty or oversized inputs; strictly avoids random or fabricated vectors.
 */

import { GoogleGenAI } from '@google/genai';
import type { EmbeddingProviderType, IEmbeddingProvider } from '../../lib/types.ts';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
export const EMBEDDING_DIMENSIONS = 768;
export const MAX_EMBEDDING_BATCH_SIZE = 100;
export const MAX_EMBEDDING_INPUT_CHARS = 8000;

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

export type EmbeddingErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'PROVIDER_ERROR'
  | 'INVALID_OUTPUT';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: EmbeddingErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(`[Embedding] ${code}: ${message}`);
    this.name = 'EmbeddingError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface EmbeddingConfig {
  apiKey?: string;
  model?: string;
  dimensions?: number;
  maxBatchSize?: number;
  maxInputChars?: number;
  /** Injected client for unit testing with deterministic mocks */
  client?: unknown;
}

export interface EmbeddingModelInfo {
  provider: 'gemini';
  model: string;
  dimensions: number;
  maxBatchSize: number;
  maxInputChars: number;
}

export interface ChunkEmbeddingInput {
  content: string;
  title?: string;
}

function redactKey(str: string, key?: string): string {
  if (!str) return '';
  let cleaned = str;
  if (key && key.length > 5) {
    cleaned = cleaned.split(key).join('[REDACTED_API_KEY]');
  }
  return cleaned.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]');
}

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  readonly id: EmbeddingProviderType = 'gemini';
  readonly name = 'Google Gemini Text Embeddings';
  readonly modelId: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
  readonly maxInputChars: number;

  private apiKey?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdkClient: any;

  constructor(config?: EmbeddingConfig) {
    this.apiKey =
      config?.apiKey ??
      process.env.EMBEDDING_API_KEY ??
      process.env.GEMINI_API_KEY;

    this.modelId =
      config?.model ??
      process.env.EMBEDDING_MODEL ??
      DEFAULT_EMBEDDING_MODEL;

    this.dimensions =
      config?.dimensions ??
      (process.env.EMBEDDING_DIMENSIONS
        ? parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
        : EMBEDDING_DIMENSIONS);

    this.maxBatchSize = config?.maxBatchSize ?? MAX_EMBEDDING_BATCH_SIZE;
    this.maxInputChars = config?.maxInputChars ?? MAX_EMBEDDING_INPUT_CHARS;

    if (config?.client) {
      this.sdkClient = config.client;
    } else if (this.apiKey && this.apiKey.trim().length > 0) {
      this.sdkClient = new GoogleGenAI({ apiKey: this.apiKey.trim() });
    }
  }

  /**
   * Returns true if provider is configured with credentials or mock client.
   */
  isConfigured(): boolean {
    return Boolean(this.sdkClient || (this.apiKey && this.apiKey.trim().length > 0));
  }

  /**
   * Returns metadata about the configured embedding model.
   */
  getModelInfo(): EmbeddingModelInfo {
    return {
      provider: 'gemini',
      model: this.modelId,
      dimensions: this.dimensions,
      maxBatchSize: this.maxBatchSize,
      maxInputChars: this.maxInputChars,
    };
  }

  /**
   * Validates a single text input string before sending to provider.
   */
  validateInput(text: unknown, label = 'Input'): string {
    if (typeof text !== 'string') {
      throw new EmbeddingError(
        'VALIDATION_ERROR',
        `${label} must be a string, received ${typeof text}.`
      );
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new EmbeddingError(
        'VALIDATION_ERROR',
        `${label} cannot be empty or whitespace-only.`
      );
    }

    if (trimmed.length > this.maxInputChars) {
      throw new EmbeddingError(
        'VALIDATION_ERROR',
        `${label} length (${trimmed.length} chars) exceeds the maximum allowed limit of ${this.maxInputChars} characters.`,
        { actualLength: trimmed.length, maxLength: this.maxInputChars }
      );
    }

    return trimmed;
  }

  /**
   * Validates that returned embedding vector contains finite numbers of correct dimensions.
   */
  validateVector(vector: unknown, index = 0): number[] {
    if (!Array.isArray(vector)) {
      throw new EmbeddingError(
        'INVALID_OUTPUT',
        `Provider output at index ${index} is not an array.`,
        { outputType: typeof vector }
      );
    }

    if (vector.length !== this.dimensions) {
      throw new EmbeddingError(
        'INVALID_OUTPUT',
        `Vector dimension mismatch: expected ${this.dimensions} dimensions, but received ${vector.length}.`,
        { expectedDimensions: this.dimensions, actualDimensions: vector.length, index }
      );
    }

    for (let i = 0; i < vector.length; i++) {
      const val = vector[i];
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throw new EmbeddingError(
          'INVALID_OUTPUT',
          `Vector at index ${index} contains invalid non-numeric element at dimension ${i}: ${val}.`,
          { dimensionIndex: i, invalidValue: val }
        );
      }
    }

    return vector as number[];
  }

  /**
   * Embeds a user search query using RETRIEVAL_QUERY task type.
   */
  async embedQuery(query: string): Promise<number[]> {
    const cleanQuery = this.validateInput(query, 'Query');
    const results = await this.executeEmbed([cleanQuery], 'RETRIEVAL_QUERY');
    return results[0];
  }

  /**
   * Embeds a single document chunk using RETRIEVAL_DOCUMENT task type.
   */
  async embedDocumentChunk(chunkText: string, title?: string): Promise<number[]> {
    const cleanText = this.validateInput(chunkText, 'Document chunk');
    const results = await this.executeEmbed([cleanText], 'RETRIEVAL_DOCUMENT', title);
    return results[0];
  }

  /**
   * Embeds multiple document chunks, automatically chunking into sub-batches within provider limits.
   */
  async embedDocumentChunks(
    chunks: Array<ChunkEmbeddingInput | string>
  ): Promise<number[][]> {
    if (!Array.isArray(chunks)) {
      throw new EmbeddingError(
        'VALIDATION_ERROR',
        'Chunks input must be an array.'
      );
    }

    if (chunks.length === 0) {
      return [];
    }

    const cleanedTexts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const item = chunks[i];
      const text = typeof item === 'string' ? item : item?.content;
      cleanedTexts.push(this.validateInput(text, `Document chunk at index ${i}`));
    }

    return this.embedBatch(cleanedTexts, 'RETRIEVAL_DOCUMENT');
  }

  /**
   * Embeds a batch of texts with automatic batch windowing.
   */
  async embedBatch(
    texts: string[],
    taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
    title?: string
  ): Promise<number[][]> {
    if (!Array.isArray(texts)) {
      throw new EmbeddingError(
        'VALIDATION_ERROR',
        'Texts input must be an array.'
      );
    }

    if (texts.length === 0) {
      return [];
    }

    // Validate all inputs before issuing any network requests
    const validatedTexts = texts.map((t, idx) =>
      this.validateInput(t, `Batch input at index ${idx}`)
    );

    // If within single batch limit, execute directly
    if (validatedTexts.length <= this.maxBatchSize) {
      return this.executeEmbed(validatedTexts, taskType, title);
    }

    // Otherwise slice into sub-batches of maxBatchSize
    const allVectors: number[][] = [];
    for (let i = 0; i < validatedTexts.length; i += this.maxBatchSize) {
      const subBatch = validatedTexts.slice(i, i + this.maxBatchSize);
      const subVectors = await this.executeEmbed(subBatch, taskType, title);
      allVectors.push(...subVectors);
    }

    return allVectors;
  }

  /**
   * IEmbeddingProvider interface implementation (backward compatibility).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    return this.embedQuery(text);
  }

  /**
   * IEmbeddingProvider interface implementation (backward compatibility).
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return this.embedBatch(texts, 'RETRIEVAL_DOCUMENT');
  }

  /**
   * Internal execution against GoogleGenAI models.embedContent.
   */
  private async executeEmbed(
    texts: string[],
    taskType: EmbeddingTaskType,
    title?: string
  ): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new EmbeddingError(
        'CONFIGURATION_ERROR',
        'Gemini embedding provider is not configured. Missing GEMINI_API_KEY in server environment.'
      );
    }

    // Ensure client is initialized
    if (!this.sdkClient && this.apiKey) {
      this.sdkClient = new GoogleGenAI({ apiKey: this.apiKey });
    }

    try {
      // Build request payload for @google/genai SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configObj: Record<string, any> = {
        taskType,
        outputDimensionality: this.dimensions,
      };
      if (title && title.trim()) {
        configObj.title = title.trim();
      }

      // Format contents: string for single, string[] for multiple
      const contentsPayload = texts.length === 1 ? texts[0] : texts;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let response: any;
      try {
        response = await this.sdkClient.models.embedContent({
          model: this.modelId,
          contents: contentsPayload,
          config: configObj,
        });
      } catch (embedErr: unknown) {
        const errMsg = embedErr instanceof Error ? embedErr.message : String(embedErr);
        if (
          (errMsg.includes('404') || errMsg.toLowerCase().includes('not found')) &&
          this.modelId !== 'gemini-embedding-001'
        ) {
          response = await this.sdkClient.models.embedContent({
            model: 'gemini-embedding-001',
            contents: contentsPayload,
            config: configObj,
          });
        } else {
          throw embedErr;
        }
      }

      // Extract raw vectors from response
      const rawVectors = this.extractVectors(response, texts.length);

      if (rawVectors.length !== texts.length) {
        throw new EmbeddingError(
          'INVALID_OUTPUT',
          `Provider returned ${rawVectors.length} vectors for ${texts.length} inputs.`,
          { expectedCount: texts.length, actualCount: rawVectors.length }
        );
      }

      // Validate each vector's dimensionality and finite numeric values
      return rawVectors.map((v, i) => this.validateVector(v, i));
    } catch (err: unknown) {
      if (err instanceof EmbeddingError) {
        throw err;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      const cleanedMessage = redactKey(errMsg, this.apiKey);
      const lower = cleanedMessage.toLowerCase();

      // Check for rate limit / quota exhaustion
      if (
        lower.includes('429') ||
        lower.includes('resource_exhausted') ||
        lower.includes('quota') ||
        lower.includes('rate limit')
      ) {
        throw new EmbeddingError(
          'RATE_LIMIT_ERROR',
          `Gemini rate limit or quota exceeded for embedding model ${this.modelId}.`,
          { originalError: cleanedMessage },
          429
        );
      }

      // Check for authentication / API key failure
      if (
        lower.includes('401') ||
        lower.includes('403') ||
        lower.includes('api_key') ||
        lower.includes('unauthenticated') ||
        lower.includes('permission_denied')
      ) {
        throw new EmbeddingError(
          'CONFIGURATION_ERROR',
          `Gemini authentication failed: ${cleanedMessage}`,
          { originalError: cleanedMessage },
          401
        );
      }

      // Check for model not found
      if (lower.includes('404') || lower.includes('not found')) {
        throw new EmbeddingError(
          'PROVIDER_ERROR',
          `Embedding model '${this.modelId}' was not found or is unavailable.`,
          { originalError: cleanedMessage },
          404
        );
      }

      throw new EmbeddingError(
        'PROVIDER_ERROR',
        `Failed to generate embeddings from ${this.modelId}: ${cleanedMessage}`,
        { originalError: cleanedMessage }
      );
    }
  }

  /**
   * Safely extracts vector arrays from diverse @google/genai SDK response shapes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractVectors(response: any, expectedCount: number): any[] {
    // 1. Multiple embeddings: response.embeddings array
    if (Array.isArray(response?.embeddings) && response.embeddings.length > 0) {
      return response.embeddings.map((item: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const it = item as any;
        if (Array.isArray(it?.values)) return it.values;
        if (Array.isArray(it)) return it;
        return [];
      });
    }

    // 2. Single embedding: response.embedding.values
    if (Array.isArray(response?.embedding?.values)) {
      return [response.embedding.values];
    }

    // 3. Inlined responses array
    if (Array.isArray(response?.inlinedEmbedContentResponses)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return response.inlinedEmbedContentResponses.map((item: any) => {
        return item?.response?.embedding?.values ?? [];
      });
    }

    // 4. If single input and response itself has values
    if (expectedCount === 1 && Array.isArray(response?.values)) {
      return [response.values];
    }

    return [];
  }
}

/**
 * Centrally configured default embedding provider instance.
 */
export const defaultEmbeddingProvider = new GeminiEmbeddingProvider();
