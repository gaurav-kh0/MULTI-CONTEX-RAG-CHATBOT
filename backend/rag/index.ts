import {
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
  RagSearchResult,
} from '@/lib/types';
import { defaultEmbeddingProvider } from '@/backend/providers';
import { defaultVectorStore } from '@/backend/storage';
import { TextChunker, textChunker } from './chunker.ts';

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

export const defaultChunker = textChunker;
export const defaultRetriever = new RagRetriever();

export {
  TextChunker,
  textChunker,
  normalizeChunkWhitespace,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  MIN_CHUNK_SIZE,
} from './chunker.ts';

export type {
  ChunkerOptions,
  ChunkMetadata,
  DocumentChunkResult,
} from './chunker.ts';

export {
  DocumentProcessor,
  documentProcessor,
  DocumentProcessorError,
  normalizeWhitespace,
  DEFAULT_MAX_PDF_SIZE_BYTES,
  DEFAULT_MIN_PDF_SIZE_BYTES,
} from './document-processor.ts';

export type {
  PdfValidationOptions,
  ProcessedPdfMetadata,
  DocumentProcessorErrorCode,
  ExtractedPage,
  ExtractedPdfDocument,
} from './document-processor.ts';

export {
  GeminiEmbeddingProvider,
  defaultEmbeddingProvider as geminiEmbeddingProvider,
  EmbeddingError,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  MAX_EMBEDDING_BATCH_SIZE,
  MAX_EMBEDDING_INPUT_CHARS,
} from './embeddings.ts';

export type {
  EmbeddingConfig,
  EmbeddingModelInfo,
  ChunkEmbeddingInput,
  EmbeddingTaskType,
  EmbeddingErrorCode,
} from './embeddings.ts';
