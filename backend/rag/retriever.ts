/**
 * RAG Retriever (Server-Only Query Retrieval Layer)
 *
 * Implements context-aware vector similarity retrieval across partitioned knowledge domains
 * (NEC, Wattmonk, General) using the configured embedding and vector storage interfaces.
 *
 * Retrieval Pipeline:
 * 1. Validate the question (non-empty, string, bounded length).
 * 2. Generate query embedding using the configured query model (Google text-embedding-004, 768 dims).
 * 3. Query the active vector store (Pinecone or in-memory fallback) reusing existing storage interfaces.
 * 4. Apply domain context (NEC, WATTMONK, GENERAL) and optional document-ID filters.
 * 5. Normalize returned chunk metadata and preserve actual similarity scores (no fabrication).
 * 6. Apply configurable topK ranking and relevance-threshold filtering.
 * 7. Return an empty result when no suitable evidence exists above the threshold.
 *
 * Relevance Threshold Evaluation Guide:
 * -------------------------------------
 * In cosine similarity spaces (such as Pinecone cosine metric with Google text-embedding-004 vectors):
 * - Raw Cosine Range: [-1.0, 1.0]. Normalized text embeddings typically yield similarities between 0.50 and 0.90.
 * - Strict Threshold (0.75 - 0.85):
 *     Best for precision-critical regulatory code lookups (e.g. exact NEC Article 690 conductor sizing rules).
 *     Minimizes false positives and hallucinations, but may discard relevant text if the user's phrasing is informal.
 * - Moderate Threshold (0.60 - 0.70, Default: 0.65):
 *     Balanced operational threshold for solar engineering and technical QA. Captures semantically equivalent
 *     terminology (e.g., "rapid shutdown device" vs "module-level power electronics disconnect") without admitting noise.
 * - Permissive Threshold (< 0.55):
 *     High recall, but introduces significant prompt contamination from loosely related paragraphs.
 * - Recommended Calibration Workflow for Real Production Queries:
 *     1. Curate a benchmark evaluation set of 50-100 technical domain queries across NEC, Wattmonk, and General scopes.
 *     2. Manually annotate the ground-truth target document chunks for each query.
 *     3. Run a parameter sweep across threshold values [0.55, 0.60, 0.65, 0.70, 0.75].
 *     4. Compute Precision@K and Recall@K curves. Select the operating threshold that maximizes Recall@K while
 *        maintaining Precision@K >= 90%.
 */

import type {
  ContextType,
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
  RagSearchResult,
  SourceReference,
} from '../../lib/types.ts';
import {
  defaultEmbeddingProvider,
  GeminiEmbeddingProvider,
  EmbeddingError,
  EMBEDDING_DIMENSIONS,
} from './embeddings.ts';
import {
  getActiveVectorStore,
  PineconeStorageError,
} from '../storage/index.ts';

export const DEFAULT_RETRIEVAL_TOP_K = 4;
export const DEFAULT_MIN_SCORE_THRESHOLD = 0.65;
export const MAX_QUERY_LENGTH = 2000;

export type RetrieverErrorCode =
  | 'VALIDATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'EMBEDDING_ERROR'
  | 'STORAGE_ERROR';

export class RetrieverError extends Error {
  readonly code: RetrieverErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: RetrieverErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(`[Retriever] ${code}: ${message}`);
    this.name = 'RetrieverError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface RetrieverConfig {
  /** Active vector store (defaults to getActiveVectorStore(), reusing Pinecone or fallback) */
  vectorStore?: IVectorStore;
  /** Active embedding provider (defaults to defaultEmbeddingProvider targeting text-embedding-004) */
  embeddingProvider?: IEmbeddingProvider;
  /** Default top-K candidate chunks to return (default: 4 or RAG_DEFAULT_TOP_K) */
  defaultTopK?: number;
  /** Default cosine similarity cutoff threshold (default: 0.65 or RAG_MIN_SCORE_THRESHOLD) */
  minScoreThreshold?: number;
  /** Maximum allowed query character length (default: 2000) */
  maxQueryLength?: number;
}

export interface RetrieveOptions extends RagQueryOptions {
  /** Target candidate chunks limit (default: 4) */
  topK?: number;
  /** Minimum similarity score threshold (default: 0.65) */
  minScoreThreshold?: number;
  /** Partitioned context scopes to restrict search (NEC, WATTMONK, GENERAL) */
  contexts?: ContextType[];
  /** Filter retrieval strictly to a single document ID */
  documentId?: string;
  /** Optional namespace for partitioned vector stores */
  namespace?: string;
}

export class RagRetriever {
  private vectorStore: IVectorStore;
  private embeddingProvider: IEmbeddingProvider;
  private defaultTopK: number;
  private minScoreThreshold: number;
  private maxQueryLength: number;

  constructor(config?: RetrieverConfig) {
    this.vectorStore = config?.vectorStore ?? getActiveVectorStore();
    this.embeddingProvider = config?.embeddingProvider ?? defaultEmbeddingProvider;

    this.defaultTopK =
      config?.defaultTopK ??
      (process.env.RAG_DEFAULT_TOP_K
        ? parseInt(process.env.RAG_DEFAULT_TOP_K, 10)
        : DEFAULT_RETRIEVAL_TOP_K);

    this.minScoreThreshold =
      config?.minScoreThreshold ??
      (process.env.RAG_MIN_SCORE_THRESHOLD
        ? parseFloat(process.env.RAG_MIN_SCORE_THRESHOLD)
        : DEFAULT_MIN_SCORE_THRESHOLD);

    this.maxQueryLength = config?.maxQueryLength ?? MAX_QUERY_LENGTH;
  }

  /**
   * Returns the configured vector store instance.
   */
  getVectorStore(): IVectorStore {
    return this.vectorStore;
  }

  /**
   * Returns the configured embedding provider instance.
   */
  getEmbeddingProvider(): IEmbeddingProvider {
    return this.embeddingProvider;
  }

  /**
   * Returns current default topK setting.
   */
  getDefaultTopK(): number {
    return this.defaultTopK;
  }

  /**
   * Returns current default similarity threshold setting.
   */
  getMinScoreThreshold(): number {
    return this.minScoreThreshold;
  }

  /**
   * Validates a user query string before processing.
   *
   * @throws RetrieverError('VALIDATION_ERROR') if query is invalid.
   */
  validateQuestion(question: unknown): string {
    if (typeof question !== 'string') {
      throw new RetrieverError(
        'VALIDATION_ERROR',
        `Question must be a string, received ${typeof question}.`
      );
    }

    const trimmed = question.trim();
    if (trimmed.length === 0) {
      throw new RetrieverError(
        'VALIDATION_ERROR',
        'Question cannot be empty or whitespace-only.'
      );
    }

    if (trimmed.length > this.maxQueryLength) {
      throw new RetrieverError(
        'VALIDATION_ERROR',
        `Question length (${trimmed.length} chars) exceeds the maximum allowed limit of ${this.maxQueryLength} characters.`,
        { actualLength: trimmed.length, maxLength: this.maxQueryLength }
      );
    }

    return trimmed;
  }

  /**
   * Validates and normalizes retrieval options (topK, threshold, filters).
   */
  private normalizeOptions(options?: RetrieveOptions): {
    topK: number;
    minScoreThreshold: number;
    contexts?: ContextType[];
    documentId?: string;
    namespace?: string;
  } {
    const topK = options?.topK ?? this.defaultTopK;
    if (typeof topK !== 'number' || !Number.isInteger(topK) || topK <= 0) {
      throw new RetrieverError(
        'VALIDATION_ERROR',
        `topK must be a positive integer, received ${topK}.`
      );
    }

    const minScoreThreshold = options?.minScoreThreshold ?? this.minScoreThreshold;
    if (typeof minScoreThreshold !== 'number' || !Number.isFinite(minScoreThreshold)) {
      throw new RetrieverError(
        'VALIDATION_ERROR',
        `minScoreThreshold must be a valid finite number, received ${minScoreThreshold}.`
      );
    }

    const documentId = options?.documentId?.trim() ? options.documentId.trim() : undefined;
    const contexts =
      Array.isArray(options?.contexts) && options.contexts.length > 0
        ? Array.from(new Set(options.contexts))
        : undefined;

    return {
      topK,
      minScoreThreshold,
      contexts,
      documentId,
      namespace: options?.namespace?.trim() || undefined,
    };
  }

  /**
   * Generates a 768-dim query embedding vector using the configured query model.
   *
   * @throws RetrieverError if provider is unconfigured, rate-limited, or fails.
   */
  private async generateQueryEmbedding(cleanQuestion: string): Promise<number[]> {
    // 1. Guard configuration state
    if (
      'isConfigured' in this.embeddingProvider &&
      typeof (this.embeddingProvider as unknown as { isConfigured: () => boolean }).isConfigured === 'function'
    ) {
      const configured = (this.embeddingProvider as unknown as { isConfigured: () => boolean }).isConfigured();
      if (!configured) {
        throw new RetrieverError(
          'CONFIGURATION_ERROR',
          'Embedding provider is not configured. Missing GEMINI_API_KEY in server environment.'
        );
      }
    }

    // 2. Execute embedding generation with task type RETRIEVAL_QUERY
    try {
      let vector: number[];
      if (
        'embedQuery' in this.embeddingProvider &&
        typeof (this.embeddingProvider as unknown as { embedQuery: (q: string) => Promise<number[]> }).embedQuery === 'function'
      ) {
        vector = await (this.embeddingProvider as unknown as { embedQuery: (q: string) => Promise<number[]> }).embedQuery(cleanQuestion);
      } else {
        vector = await this.embeddingProvider.generateEmbedding(cleanQuestion);
      }

      if (!Array.isArray(vector) || vector.length === 0) {
        throw new RetrieverError(
          'EMBEDDING_ERROR',
          'Embedding provider returned empty or malformed vector array.'
        );
      }

      return vector;
    } catch (err: unknown) {
      if (err instanceof RetrieverError) throw err;
      if (err instanceof EmbeddingError) {
        const code =
          err.code === 'CONFIGURATION_ERROR'
            ? 'CONFIGURATION_ERROR'
            : err.code === 'VALIDATION_ERROR'
            ? 'VALIDATION_ERROR'
            : 'EMBEDDING_ERROR';
        throw new RetrieverError(code, err.message, err.details);
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new RetrieverError(
        'EMBEDDING_ERROR',
        `Query embedding generation failed: ${msg}`,
        { originalError: msg }
      );
    }
  }

  /**
   * Queries the underlying vector storage layer using the generated query embedding.
   *
   * @throws RetrieverError on configuration or storage failures.
   */
  private async queryVectorStorage(
    vector: number[],
    params: {
      topK: number;
      minScoreThreshold: number;
      contexts?: ContextType[];
      documentId?: string;
      namespace?: string;
    }
  ): Promise<RagRetrievalResult[]> {
    // 1. Guard storage configuration if PineconeVectorStore
    if (
      'isConfigured' in this.vectorStore &&
      typeof (this.vectorStore as unknown as { isConfigured: () => boolean }).isConfigured === 'function'
    ) {
      const configured = (this.vectorStore as unknown as { isConfigured: () => boolean }).isConfigured();
      if (!configured) {
        throw new RetrieverError(
          'CONFIGURATION_ERROR',
          'Vector store is not configured. Missing PINECONE_API_KEY in server environment.'
        );
      }
    }

    // 2. Query storage reusing existing vectorStore implementation
    try {
      const rawResults = await this.vectorStore.querySimilar(vector, {
        topK: Math.max(params.topK * 2, 10), // Fetch adequate candidates for post-normalization & filtering
        minScoreThreshold: params.minScoreThreshold,
        contexts: params.contexts,
        documentId: params.documentId,
        namespace: params.namespace,
      });

      return Array.isArray(rawResults) ? rawResults : [];
    } catch (err: unknown) {
      if (err instanceof RetrieverError) throw err;
      if (err instanceof PineconeStorageError) {
        const code =
          err.code === 'CONFIGURATION_ERROR'
            ? 'CONFIGURATION_ERROR'
            : err.code === 'VALIDATION_ERROR'
            ? 'VALIDATION_ERROR'
            : 'STORAGE_ERROR';
        throw new RetrieverError(code, err.message, err.details);
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new RetrieverError(
        'STORAGE_ERROR',
        `Vector storage query failed: ${msg}`,
        { originalError: msg }
      );
    }
  }

  /**
   * Sanitizes, normalizes, and filters candidate matches:
   * - Verifies finite numeric similarity score (strictly NO fabrication).
   * - Enforces minScoreThreshold cutoff.
   * - Enforces context and documentId filters.
   * - Cleans chunk metadata and constructs typed RagRetrievalResult.
   */
  private normalizeMatches(
    rawResults: RagRetrievalResult[],
    params: {
      topK: number;
      minScoreThreshold: number;
      contexts?: ContextType[];
      documentId?: string;
    }
  ): RagRetrievalResult[] {
    const validMatches: RagRetrievalResult[] = [];

    for (const raw of rawResults) {
      if (!raw || !raw.chunk) {
        continue;
      }

      // 1. Validate actual similarity score (must be a finite number; never fabricate)
      const score = typeof raw.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0;
      if (score < params.minScoreThreshold) {
        continue;
      }

      const meta = (raw.chunk.metadata || {}) as Record<string, unknown>;

      // 2. Normalize document ID
      const docId = String(raw.chunk.documentId || meta.documentId || '').trim();
      if (!docId) {
        continue;
      }

      // Apply documentId filter defense-in-depth
      if (params.documentId && docId !== params.documentId) {
        continue;
      }

      // 3. Normalize content
      const content = String(raw.chunk.content || meta.text || '').trim();
      if (!content) {
        continue;
      }

      // 4. Normalize context
      const rawContext = (meta.context || meta.contextType || raw.contextType || 'GENERAL') as string;
      const normalizedContext: ContextType =
        rawContext === 'NEC' || rawContext === 'WATTMONK' || rawContext === 'GENERAL'
          ? (rawContext as ContextType)
          : 'GENERAL';

      // Apply context filter defense-in-depth
      if (params.contexts && params.contexts.length > 0 && !params.contexts.includes(normalizedContext)) {
        continue;
      }

      // 5. Normalize metadata fields
      const chunkIndex =
        typeof raw.chunk.chunkIndex === 'number'
          ? raw.chunk.chunkIndex
          : typeof meta.chunkIndex === 'number'
          ? meta.chunkIndex
          : 0;

      const pageNumber =
        typeof meta.pageNumber === 'number' && meta.pageNumber > 0
          ? meta.pageNumber
          : undefined;

      const filename = String(meta.filename || meta.originalFilename || raw.documentName || 'Unknown Document');
      const title = meta.title ? String(meta.title) : filename;

      const cleanedChunk: DocumentChunk = {
        id: raw.chunk.id || `${docId}_chunk_${chunkIndex}`,
        documentId: docId,
        content,
        chunkIndex,
        metadata: {
          ...meta,
          documentId: docId,
          chunkIndex,
          pageNumber,
          context: normalizedContext,
          filename,
          title,
        },
        tokenCount: raw.chunk.tokenCount ?? Math.ceil(content.length / 4),
      };

      validMatches.push({
        chunk: cleanedChunk,
        score,
        documentName: filename,
        contextType: normalizedContext,
      });
    }

    // Sort strictly by actual similarity score descending (highest relevance first)
    validMatches.sort((a, b) => b.score - a.score);

    // Apply topK limit
    return validMatches.slice(0, params.topK);
  }

  /**
   * Executes an end-to-end RAG retrieval query:
   * 1. Validates the question.
   * 2. Generates query embedding.
   * 3. Queries vector store with filters.
   * 4. Normalizes metadata and similarity scores.
   * 5. Filters by relevance threshold and limits to topK.
   * 6. Returns empty result if no evidence meets the threshold.
   */
  async retrieve(
    question: string,
    options?: RetrieveOptions
  ): Promise<RagSearchResult> {
    // 1. Validate question
    const cleanQuestion = this.validateQuestion(question);

    // 2. Normalize options
    const normalizedOptions = this.normalizeOptions(options);

    // 3. Generate query embedding vector
    const queryVector = await this.generateQueryEmbedding(cleanQuestion);

    // 4. Query vector store using existing storage abstraction
    const rawMatches = await this.queryVectorStorage(queryVector, normalizedOptions);

    // 5. Normalize metadata, apply threshold, and sort by relevance
    const finalResults = this.normalizeMatches(rawMatches, normalizedOptions);

    // 6. Return typed result (empty if no matches meet criteria)
    return {
      query: cleanQuestion,
      results: finalResults,
      totalResults: finalResults.length,
    };
  }

  /**
   * Helper to convert RagRetrievalResult array into standardized citation SourceReferences
   * containing only verified metadata (never invented page numbers, scores, or URLs).
   */
  toSourceReferences(results: RagRetrievalResult[]): SourceReference[] {
    return results.map((r) => {
      const meta = (r.chunk?.metadata || {}) as Record<string, unknown>;

      const docId = String(r.chunk?.documentId || meta.documentId || '').trim();
      const chunkId = String(r.chunk?.id || '').trim();

      const rawFilename =
        typeof meta.filename === 'string' && meta.filename.trim()
          ? meta.filename.trim()
          : typeof meta.originalFilename === 'string' && meta.originalFilename.trim()
          ? meta.originalFilename.trim()
          : typeof r.documentName === 'string' && r.documentName.trim() && r.documentName !== 'Unknown Document'
          ? r.documentName.trim()
          : undefined;

      const rawTitle =
        typeof meta.title === 'string' && meta.title.trim()
          ? meta.title.trim()
          : rawFilename;

      // Page number only if finite, positive integer reliably provided by parser
      const pageNumber =
        typeof meta.pageNumber === 'number' && Number.isInteger(meta.pageNumber) && meta.pageNumber > 0
          ? meta.pageNumber
          : undefined;

      // Score only if finite number supplied by vector store
      const score =
        typeof r.score === 'number' && Number.isFinite(r.score)
          ? r.score
          : undefined;

      // Excerpt only if non-empty string
      const rawContent = r.chunk?.content || meta.text || '';
      const snippet =
        typeof rawContent === 'string' && rawContent.trim().length > 0
          ? rawContent.trim()
          : undefined;

      const contextType =
        r.contextType || (meta.context as ContextType) || (meta.contextType as ContextType) || undefined;

      return {
        documentId: docId,
        chunkId: chunkId || `${docId}_chunk_0`,
        filename: rawFilename,
        documentName: rawFilename || rawTitle,
        documentTitle: rawTitle,
        pageNumber,
        score,
        snippet,
        excerpt: snippet,
        contextType,
      };
    });
  }
}

/**
 * Centrally configured default RAG retriever instance.
 */
export const ragRetriever = new RagRetriever();
export const retriever = ragRetriever;
export const defaultRetriever = ragRetriever;
