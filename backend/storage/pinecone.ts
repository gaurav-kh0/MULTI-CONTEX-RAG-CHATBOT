/**
 * Pinecone Vector Storage Module
 *
 * Implements IVectorStore using the official Pinecone TypeScript SDK (@pinecone-database/pinecone).
 *
 * Requirements & Security:
 * 1. Reads credentials (PINECONE_API_KEY) and index name (PINECONE_INDEX_NAME) exclusively from server-side environment.
 * 2. Validates vector dimensions against the configured index (default: 768 for text-embedding-004).
 * 3. Uses deterministic vector IDs (${documentId}_chunk_${chunkIndex}) to support idempotent upserts.
 * 4. Stores useful document metadata (documentId, chunkIndex, text, context, filename, pageNumber).
 * 5. Supports filtering by partitioned context (NEC, WATTMONK, GENERAL) and documentId.
 * 6. Handles missing indexes, invalid credentials, rate limits, and network errors clearly.
 * 7. Strictly avoids creating or modifying indexes silently without explicit configuration.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import type {
  ContextType,
  DocumentChunk,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../../lib/types.ts';
import { EMBEDDING_DIMENSIONS } from '../rag/embeddings.ts';

export const DEFAULT_PINECONE_INDEX_NAME = 'multi-context-rag';
export const DEFAULT_PINECONE_DIMENSION = EMBEDDING_DIMENSIONS; // 768
export const MAX_PINECONE_BATCH_SIZE = 100;

export type PineconeErrorCode =
  | 'CONFIGURATION_ERROR'   // Missing API key or index name
  | 'AUTHENTICATION_ERROR'  // HTTP 401: Invalid API key
  | 'INDEX_NOT_FOUND'       // HTTP 404: Index does not exist
  | 'DIMENSION_MISMATCH'    // Vector dimensions != index dimension
  | 'VALIDATION_ERROR'      // Invalid input (empty vectors, malformed IDs)
  | 'RATE_LIMIT_ERROR'      // HTTP 429
  | 'STORAGE_ERROR';        // General service or network error

export class PineconeStorageError extends Error {
  readonly code: PineconeErrorCode;
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PineconeErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number
  ) {
    super(`[Pinecone] ${code}: ${message}`);
    this.name = 'PineconeStorageError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface PineconeStoreConfig {
  apiKey?: string;
  indexName?: string;
  dimension?: number;
  namespace?: string;
  /** Injected client for unit testing with deterministic mocks */
  client?: unknown;
}

export interface PineconeIndexStatus {
  ready: boolean;
  name: string;
  dimension: number;
  metric?: string;
  host?: string;
  state?: string;
}

export interface PineconeQueryOptions extends RagQueryOptions {
  topK?: number;
  minScoreThreshold?: number;
  contexts?: ContextType[];
  documentId?: string;
  namespace?: string;
}

export interface PineconeRecordMetadata {
  documentId: string;
  chunkIndex: number;
  text: string;
  context: ContextType | string;
  filename?: string;
  pageNumber?: number;
  characterCount?: number;
  [key: string]: unknown;
}

function redactKey(str: string, key?: string): string {
  if (!str) return '';
  let cleaned = str;
  if (key && key.length > 5) {
    cleaned = cleaned.split(key).join('[REDACTED_API_KEY]');
  }
  return cleaned.replace(/pcsk_[0-9A-Za-z-_]{30,}/g, '[REDACTED_API_KEY]');
}

export class PineconeVectorStore implements IVectorStore {
  readonly indexName: string;
  readonly dimension: number;
  readonly namespace?: string;

  private apiKey?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private indexInstance: any;

  constructor(config?: PineconeStoreConfig) {
    this.apiKey =
      config?.apiKey ??
      process.env.PINECONE_API_KEY;

    this.indexName =
      config?.indexName ??
      process.env.PINECONE_INDEX_NAME ??
      process.env.PINECONE_INDEX ??
      DEFAULT_PINECONE_INDEX_NAME;

    this.dimension =
      config?.dimension ??
      (process.env.PINECONE_DIMENSION
        ? parseInt(process.env.PINECONE_DIMENSION, 10)
        : DEFAULT_PINECONE_DIMENSION);

    this.namespace =
      config?.namespace ??
      process.env.PINECONE_NAMESPACE;

    if (config?.client) {
      this.client = config.client;
    } else if (this.apiKey && this.apiKey.trim().length > 0) {
      this.client = new Pinecone({ apiKey: this.apiKey.trim() });
    }
  }

  /**
   * Returns true if client has an API key configured.
   */
  isConfigured(): boolean {
    return Boolean(this.client || (this.apiKey && this.apiKey.trim().length > 0));
  }

  /**
   * Lazily resolves and caches the Pinecone Index handle.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getIndex(overrideNamespace?: string): any {
    if (!this.isConfigured()) {
      throw new PineconeStorageError(
        'CONFIGURATION_ERROR',
        'Pinecone is not configured. Missing PINECONE_API_KEY in server environment.'
      );
    }

    if (!this.client && this.apiKey) {
      this.client = new Pinecone({ apiKey: this.apiKey.trim() });
    }

    if (!this.indexInstance) {
      this.indexInstance = this.client.index(this.indexName);
    }

    const ns = overrideNamespace ?? this.namespace;
    if (ns && ns.trim().length > 0) {
      return this.indexInstance.namespace(ns.trim());
    }

    return this.indexInstance;
  }

  /**
   * Checks storage configuration and index readiness.
   *
   * Verifies:
   * 1. Credentials are valid.
   * 2. Index exists in Pinecone (does NOT create index silently).
   * 3. Index dimension matches the configured model dimensions (768).
   *
   * @throws PineconeStorageError if unconfigured, missing, or dimension mismatch.
   */
  async checkIndexReadiness(): Promise<PineconeIndexStatus> {
    if (!this.isConfigured()) {
      throw new PineconeStorageError(
        'CONFIGURATION_ERROR',
        'Pinecone is not configured. Please set PINECONE_API_KEY in server environment.'
      );
    }

    try {
      // Describe index from Pinecone control plane
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const description: any = await this.client.describeIndex(this.indexName);

      if (!description) {
        throw new PineconeStorageError(
          'INDEX_NOT_FOUND',
          `Pinecone index '${this.indexName}' does not exist. Please create it manually in the Pinecone Console with dimension ${this.dimension} and cosine metric.`
        );
      }

      // Validate dimension
      const indexDimension = description.dimension;
      if (typeof indexDimension === 'number' && indexDimension !== this.dimension) {
        throw new PineconeStorageError(
          'DIMENSION_MISMATCH',
          `Index dimension mismatch: Pinecone index '${this.indexName}' has dimension ${indexDimension}, but the embedding model requires dimension ${this.dimension}.`,
          { expectedDimension: this.dimension, actualDimension: indexDimension }
        );
      }

      const isReady =
        description.status?.ready === true ||
        description.status?.state === 'Ready';

      return {
        ready: Boolean(isReady),
        name: description.name || this.indexName,
        dimension: indexDimension ?? this.dimension,
        metric: description.metric,
        host: description.host,
        state: description.status?.state,
      };
    } catch (err: unknown) {
      if (err instanceof PineconeStorageError) {
        throw err;
      }
      this.handleSdkException(err, 'checkIndexReadiness');
    }
  }

  /**
   * Generates a stable deterministic vector ID for a document chunk.
   * Format: `${documentId}_chunk_${chunkIndex}`
   *
   * Guarantees idempotent ingestion: re-indexing the same chunk overwrites
   * the exact same vector ID without generating duplicates.
   */
  generateDeterministicId(documentId: string, chunkIndex: number): string {
    const cleanDoc = String(documentId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${cleanDoc}_chunk_${chunkIndex}`;
  }

  /**
   * Upserts document chunks with their corresponding embedding vectors.
   *
   * Requirements:
   * - Validates vector dimensions against index dimension (768).
   * - Uses deterministic vector IDs for idempotent storage.
   * - Stores useful document metadata (documentId, chunkIndex, text, context, filename, pageNumber).
   * - Bounded by batch limits (MAX_PINECONE_BATCH_SIZE = 100).
   */
  async upsertVectors(
    chunks: DocumentChunk[],
    vectors: number[][],
    namespace?: string
  ): Promise<void> {
    if (!Array.isArray(chunks) || !Array.isArray(vectors)) {
      throw new PineconeStorageError(
        'VALIDATION_ERROR',
        'Chunks and vectors must both be arrays.'
      );
    }

    if (chunks.length === 0) {
      return;
    }

    if (chunks.length !== vectors.length) {
      throw new PineconeStorageError(
        'VALIDATION_ERROR',
        `Mismatched input lengths: received ${chunks.length} chunks but ${vectors.length} vectors.`,
        { chunkCount: chunks.length, vectorCount: vectors.length }
      );
    }

    // Prepare and validate records
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: Array<{ id: string; values: number[]; metadata: Record<string, any> }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = vectors[i];

      if (!chunk || !chunk.documentId) {
        throw new PineconeStorageError(
          'VALIDATION_ERROR',
          `Chunk at index ${i} is missing required documentId.`
        );
      }

      // Validate vector
      if (!Array.isArray(vector) || vector.length !== this.dimension) {
        throw new PineconeStorageError(
          'DIMENSION_MISMATCH',
          `Vector at index ${i} has dimension ${vector?.length ?? 0}, expected ${this.dimension}.`,
          { expectedDimension: this.dimension, actualDimension: vector?.length ?? 0, chunkIndex: i }
        );
      }

      for (let d = 0; d < vector.length; d++) {
        if (typeof vector[d] !== 'number' || !Number.isFinite(vector[d])) {
          throw new PineconeStorageError(
            'VALIDATION_ERROR',
            `Vector at index ${i} has non-numeric element at dimension ${d}: ${vector[d]}.`
          );
        }
      }

      // Stable deterministic ID
      const chunkIdx = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : i;
      const stableId = chunk.id?.trim() || this.generateDeterministicId(chunk.documentId, chunkIdx);

      // Clean metadata payload for Pinecone (strings, numbers, booleans)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata: Record<string, any> = {
        documentId: String(chunk.documentId),
        chunkIndex: chunkIdx,
        text: String(chunk.content || ''),
        context: String(chunk.metadata?.context || chunk.metadata?.contextType || 'GENERAL'),
        filename: String(chunk.metadata?.filename || ''),
        pageNumber: typeof chunk.metadata?.pageNumber === 'number' ? chunk.metadata.pageNumber : 1,
        characterCount: chunk.content ? chunk.content.length : 0,
      };

      if (chunk.metadata?.title) {
        metadata.title = String(chunk.metadata.title);
      }
      if (chunk.metadata?.author) {
        metadata.author = String(chunk.metadata.author);
      }

      records.push({
        id: stableId,
        values: vector,
        metadata,
      });
    }

    const targetIndex = this.getIndex(namespace);

    try {
      // Chunk into batches of MAX_PINECONE_BATCH_SIZE (100)
      for (let i = 0; i < records.length; i += MAX_PINECONE_BATCH_SIZE) {
        const batch = records.slice(i, i + MAX_PINECONE_BATCH_SIZE);
        await targetIndex.upsert(batch);
      }
    } catch (err: unknown) {
      this.handleSdkException(err, 'upsertVectors');
    }
  }

  /**
   * Queries vectors using a query embedding, supporting context and document filtering.
   *
   * Features:
   * - Validates query vector dimensions.
   * - Constructs Pinecone metadata filter for partitioned contexts (NEC, WATTMONK, GENERAL).
   * - Constructs documentId filter if provided.
   * - Filters results below minScoreThreshold.
   * - Reconstructs typed RagRetrievalResult array.
   */
  async querySimilar(
    vector: number[],
    options?: PineconeQueryOptions
  ): Promise<RagRetrievalResult[]> {
    if (!Array.isArray(vector)) {
      throw new PineconeStorageError(
        'VALIDATION_ERROR',
        'Query vector must be an array of numbers.'
      );
    }

    if (vector.length !== this.dimension) {
      throw new PineconeStorageError(
        'DIMENSION_MISMATCH',
        `Query vector dimension ${vector.length} does not match index dimension ${this.dimension}.`,
        { expectedDimension: this.dimension, actualDimension: vector.length }
      );
    }

    for (let i = 0; i < vector.length; i++) {
      if (typeof vector[i] !== 'number' || !Number.isFinite(vector[i])) {
        throw new PineconeStorageError(
          'VALIDATION_ERROR',
          `Query vector contains invalid non-numeric element at dimension ${i}: ${vector[i]}.`
        );
      }
    }

    // Build Pinecone metadata filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filterClauses: Record<string, any>[] = [];

    // Filter by context scopes (NEC, WATTMONK, GENERAL)
    if (options?.contexts && options.contexts.length > 0) {
      if (options.contexts.length === 1) {
        filterClauses.push({ context: { $eq: options.contexts[0] } });
      } else {
        filterClauses.push({ context: { $in: options.contexts } });
      }
    }

    // Filter by specific document ID
    if (options?.documentId && options.documentId.trim().length > 0) {
      filterClauses.push({ documentId: { $eq: options.documentId.trim() } });
    }

    // Combine filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pineconeFilter: Record<string, any> | undefined = undefined;
    if (filterClauses.length === 1) {
      pineconeFilter = filterClauses[0];
    } else if (filterClauses.length > 1) {
      pineconeFilter = { $and: filterClauses };
    }

    const topK = options?.topK ?? 4;
    const targetIndex = this.getIndex(options?.namespace);

    try {
      // Execute vector similarity query
      const queryResponse = await targetIndex.query({
        vector,
        topK,
        includeMetadata: true,
        filter: pineconeFilter,
      });

      const matches = queryResponse?.matches || [];
      const minThreshold = options?.minScoreThreshold ?? -Infinity;

      const results: RagRetrievalResult[] = [];

      for (const match of matches) {
        const score = match.score ?? 0;
        if (score < minThreshold) {
          continue;
        }

        // Reconstruct DocumentChunk from stored metadata
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (match.metadata || {}) as Record<string, any>;
        const chunk: DocumentChunk = {
          id: String(match.id),
          documentId: String(meta.documentId || ''),
          content: String(meta.text || ''),
          chunkIndex: typeof meta.chunkIndex === 'number' ? meta.chunkIndex : 0,
          metadata: {
            ...meta,
            pageNumber: meta.pageNumber,
            context: meta.context,
            filename: meta.filename,
          },
        };

        results.push({
          chunk,
          score,
          documentName: String(meta.filename || meta.documentId || 'Unknown Document'),
          contextType: meta.context as ContextType,
        });
      }

      return results;
    } catch (err: unknown) {
      this.handleSdkException(err, 'querySimilar');
    }
  }

  /**
   * Deletes all vector records associated with a document ID.
   */
  async deleteByDocumentId(documentId: string, namespace?: string): Promise<void> {
    if (!documentId || typeof documentId !== 'string' || !documentId.trim()) {
      throw new PineconeStorageError(
        'VALIDATION_ERROR',
        'documentId must be a non-empty string.'
      );
    }

    const targetIndex = this.getIndex(namespace);

    try {
      await targetIndex.deleteMany({
        filter: {
          documentId: { $eq: documentId.trim() },
        },
      });
    } catch (err: unknown) {
      this.handleSdkException(err, 'deleteByDocumentId');
    }
  }

  /**
   * Normalizes Pinecone SDK exceptions into typed PineconeStorageError instances.
   */
  private handleSdkException(err: unknown, operation: string): never {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const cleanedMessage = redactKey(rawMessage, this.apiKey);
    const lower = cleanedMessage.toLowerCase();

    // Missing index
    if (
      lower.includes('not found') ||
      lower.includes('404') ||
      lower.includes('does not exist')
    ) {
      throw new PineconeStorageError(
        'INDEX_NOT_FOUND',
        `Pinecone index '${this.indexName}' was not found. Please create the index in Pinecone Console before running operations.`,
        { originalError: cleanedMessage, operation },
        404
      );
    }

    // Authentication failure
    if (
      lower.includes('unauthorized') ||
      lower.includes('401') ||
      lower.includes('forbidden') ||
      lower.includes('403') ||
      lower.includes('invalid api key') ||
      lower.includes('apikey')
    ) {
      throw new PineconeStorageError(
        'AUTHENTICATION_ERROR',
        `Pinecone authentication failed: ${cleanedMessage}`,
        { originalError: cleanedMessage, operation },
        401
      );
    }

    // Rate limit
    if (
      lower.includes('429') ||
      lower.includes('rate limit') ||
      lower.includes('quota')
    ) {
      throw new PineconeStorageError(
        'RATE_LIMIT_ERROR',
        `Pinecone rate limit exceeded during ${operation}: ${cleanedMessage}`,
        { originalError: cleanedMessage, operation },
        429
      );
    }

    // Dimension mismatch from Pinecone API
    if (lower.includes('dimension') || lower.includes('length')) {
      throw new PineconeStorageError(
        'DIMENSION_MISMATCH',
        `Pinecone dimension error: ${cleanedMessage}`,
        { originalError: cleanedMessage, operation }
      );
    }

    throw new PineconeStorageError(
      'STORAGE_ERROR',
      `Pinecone storage error during ${operation}: ${cleanedMessage}`,
      { originalError: cleanedMessage, operation }
    );
  }
}

/**
 * Singleton instance configured from environment variables.
 */
export const pineconeVectorStore = new PineconeVectorStore();
