/**
 * Search Service (Server-Only)
 *
 * Handles context-partitioned RAG queries and vector similarity searches.
 *
 * NOTICE: Vector database indexing, embedding generation, and cosine similarity
 * searches are not implemented yet. Unimplemented features return an explicit,
 * documented not-ready response.
 */

import type { ContextType, SearchRequest, SearchResponsePayload } from '../../lib/types.ts';

export class SearchService {
  async executeSearch(request: SearchRequest): Promise<SearchResponsePayload> {
    const contexts: ContextType[] =
      request.contexts && request.contexts.length > 0
        ? request.contexts
        : ['GENERAL'];

    // Explicitly documented not-ready response rather than fabricated retrieval success
    return {
      query: request.query,
      contexts,
      results: [], // Strictly no fake documents or simulated search results
      isReady: false,
      statusMessage:
        'Vector retrieval engine is not implemented yet. ' +
        'Embedding generation and vector similarity search will be connected in a future task. ' +
        'No external database was queried.',
      totalResults: 0,
    };
  }
}

export const searchService = new SearchService();
