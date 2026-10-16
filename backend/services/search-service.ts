/**
 * Search Service (Server-Only)
 *
 * Implements semantic document search across partitioned knowledge domains
 * (NEC, Wattmonk, General) by delegating directly to RagRetriever.
 * Strictly reuses the existing retriever, embedding provider, and vector storage
 * layer; does NOT implement duplicate vector math or a second storage abstraction.
 */

import type {
  ContextType,
  SearchRequest,
  SearchResponsePayload,
  SearchResultChunk,
} from '../../lib/types.ts';
import {
  RagRetriever,
  RetrieverError,
  ragRetriever,
} from '../rag/retriever.ts';
import {
  validateContextType,
  validateDocumentId,
} from '../../lib/validation.ts';

export type SearchErrorCode =
  | 'VALIDATION_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'STORAGE_ERROR'
  | 'EMBEDDING_ERROR'
  | 'INTERNAL_ERROR';

export class SearchError extends Error {
  readonly code: SearchErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SearchErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(`[SearchService] ${code}: ${message}`);
    this.name = 'SearchError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface SearchServiceConfig {
  retriever?: RagRetriever;
}

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;
export const MIN_SEARCH_LIMIT = 1;

export class SearchService {
  private retriever: RagRetriever;

  constructor(config?: SearchServiceConfig) {
    this.retriever = config?.retriever ?? ragRetriever;
  }

  getRetriever(): RagRetriever {
    return this.retriever;
  }

  /**
   * Validates and executes a semantic search query against the knowledge store.
   */
  async executeSearch(request: SearchRequest): Promise<SearchResponsePayload> {
    if (!request || typeof request !== 'object') {
      throw new SearchError('VALIDATION_ERROR', 'Search request must be an object.');
    }

    // 1. Validate query
    if (typeof request.query !== 'string') {
      throw new SearchError(
        'VALIDATION_ERROR',
        `Search query must be a string, received ${typeof request.query}.`
      );
    }

    const trimmedQuery = request.query.trim();
    if (trimmedQuery.length === 0) {
      throw new SearchError('VALIDATION_ERROR', 'Search query cannot be empty or whitespace-only.');
    }

    if (trimmedQuery.length > 1000) {
      throw new SearchError(
        'VALIDATION_ERROR',
        `Search query length (${trimmedQuery.length}) exceeds maximum limit of 1000 characters.`,
        { actualLength: trimmedQuery.length, maxLength: 1000 }
      );
    }

    // 2. Validate and normalize contexts
    let resolvedContexts: ContextType[] | undefined = undefined;
    if (request.contexts && Array.isArray(request.contexts)) {
      const validContexts: ContextType[] = [];
      for (const c of request.contexts) {
        const check = validateContextType(c);
        if (!check.valid) {
          throw new SearchError('VALIDATION_ERROR', check.error, { field: 'contexts', invalidValue: c });
        }
        if (!validContexts.includes(check.value)) {
          validContexts.push(check.value);
        }
      }
      if (validContexts.length > 0) {
        resolvedContexts = validContexts;
      }
    } else if (request.context) {
      const check = validateContextType(request.context);
      if (!check.valid) {
        throw new SearchError('VALIDATION_ERROR', check.error, { field: 'context', invalidValue: request.context });
      }
      resolvedContexts = [check.value];
    }

    // 3. Validate documentId if provided
    let resolvedDocumentId: string | undefined = undefined;
    if (request.documentId !== undefined && request.documentId !== null) {
      const docCheck = validateDocumentId(request.documentId);
      if (!docCheck.valid) {
        throw new SearchError('VALIDATION_ERROR', docCheck.error, { field: 'documentId' });
      }
      resolvedDocumentId = docCheck.value;
    }

    // 4. Validate limit / topK (1 to 50, default 10)
    const rawLimit = request.limit ?? request.topK ?? DEFAULT_SEARCH_LIMIT;
    if (
      typeof rawLimit !== 'number' ||
      !Number.isInteger(rawLimit) ||
      rawLimit < MIN_SEARCH_LIMIT ||
      rawLimit > MAX_SEARCH_LIMIT
    ) {
      throw new SearchError(
        'VALIDATION_ERROR',
        `Result limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}, received ${rawLimit}.`,
        { field: 'limit', value: rawLimit }
      );
    }
    const limit = rawLimit;

    // 5. Validate minScoreThreshold if provided
    const minScoreThreshold = request.minScoreThreshold;
    if (minScoreThreshold !== undefined) {
      if (typeof minScoreThreshold !== 'number' || !Number.isFinite(minScoreThreshold)) {
        throw new SearchError(
          'VALIDATION_ERROR',
          `minScoreThreshold must be a finite number, received ${minScoreThreshold}.`,
          { field: 'minScoreThreshold', value: minScoreThreshold }
        );
      }
    }

    // 6. Execute retrieval via existing RagRetriever
    try {
      const retrieval = await this.retriever.retrieve(trimmedQuery, {
        topK: limit,
        minScoreThreshold,
        contexts: resolvedContexts,
        documentId: resolvedDocumentId,
      });

      // 7. Map RagRetrievalResult into typed SearchResultChunk
      const results: SearchResultChunk[] = retrieval.results.map((r) => {
        const meta = (r.chunk?.metadata || {}) as Record<string, unknown>;
        const docId = String(r.chunk?.documentId || meta.documentId || '').trim();
        const chunkId = String(r.chunk?.id || `${docId}_chunk_0`).trim();
        const filename = String(
          meta.filename || meta.originalFilename || r.documentName || 'Unknown Document'
        );
        const title = meta.title ? String(meta.title) : filename;
        const pageNumber =
          typeof meta.pageNumber === 'number' && Number.isInteger(meta.pageNumber) && meta.pageNumber > 0
            ? meta.pageNumber
            : undefined;
        const excerpt = String(r.chunk?.content || meta.text || '').trim();
        const score = typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0;
        const chunkIndex =
          typeof r.chunk?.chunkIndex === 'number'
            ? r.chunk.chunkIndex
            : typeof meta.chunkIndex === 'number'
            ? meta.chunkIndex
            : 0;
        const contextType: ContextType =
          r.contextType || (meta.context as ContextType) || (meta.contextType as ContextType) || 'GENERAL';

        return {
          chunkId,
          documentId: docId,
          filename,
          documentName: filename,
          title,
          pageNumber,
          score,
          excerpt,
          contextType,
          chunkIndex,
          metadata: meta,
        };
      });

      return {
        query: trimmedQuery,
        contexts: resolvedContexts ?? (['GENERAL'] as ContextType[]),
        documentId: resolvedDocumentId,
        results,
        totalResults: results.length,
        isReady: true,
        statusMessage:
          results.length > 0
            ? `Found ${results.length} relevant document chunk(s).`
            : 'No relevant document chunks found matching the search criteria.',
      };
    } catch (err: unknown) {
      if (err instanceof SearchError) throw err;
      if (err instanceof RetrieverError) {
        throw new SearchError(err.code, err.message, err.details);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new SearchError('INTERNAL_ERROR', `Search operation failed: ${msg}`, { originalError: msg });
    }
  }
}

export const searchService = new SearchService();
