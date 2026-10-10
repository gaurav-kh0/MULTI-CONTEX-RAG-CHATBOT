import {
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
  RagSearchResult,
} from '@/lib/types';
import { defaultEmbeddingProvider } from '@/backend/providers';
import { defaultVectorStore } from '@/backend/storage';

/**
 * Structural chunking utility.
 * In future phases, specialized semantic and recursive character splitters can be added.
 */
export class TextChunker {
  chunkText(
    text: string,
    documentId: string,
    metadata: Record<string, unknown> = {},
    chunkSize = 1000
  ): DocumentChunk[] {
    if (!text) return [];

    const chunks: DocumentChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.slice(start, end);
      chunks.push({
        id: `${documentId}_chunk_${index}`,
        documentId,
        content,
        chunkIndex: index,
        metadata: {
          ...metadata,
          startIndex: start,
          endIndex: end,
        },
      });
      start = end;
      index++;
    }

    return chunks;
  }
}

/**
 * Structural RAG Retriever orchestrating embedding and vector retrieval.
 */
export class RagRetriever {
  constructor(
    private vectorStore: IVectorStore = defaultVectorStore,
    private embeddingProvider: IEmbeddingProvider = defaultEmbeddingProvider
  ) {}

  async retrieve(query: string, options?: RagQueryOptions): Promise<RagSearchResult> {
    const queryVector = await this.embeddingProvider.generateEmbedding(query);
    const results: RagRetrievalResult[] = await this.vectorStore.querySimilar(
      queryVector,
      options
    );

    return {
      query,
      results,
      totalResults: results.length,
    };
  }
}

export const defaultChunker = new TextChunker();
export const defaultRetriever = new RagRetriever();
