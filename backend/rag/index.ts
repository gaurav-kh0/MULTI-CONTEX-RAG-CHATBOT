export {
  RagRetriever,
  ragRetriever,
  ragRetriever as defaultRetriever,
  retriever,
  RetrieverError,
  DEFAULT_RETRIEVAL_TOP_K,
  DEFAULT_MIN_SCORE_THRESHOLD,
  MAX_QUERY_LENGTH,
} from './retriever.ts';

export type {
  RetrieverConfig,
  RetrieveOptions,
  RetrieverErrorCode,
} from './retriever.ts';

export {
  TextChunker,
  textChunker,
  textChunker as defaultChunker,
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

export {
  RagPipeline,
  ragPipeline,
  detectContext,
  resolveContextRouting,
  formatRetrievedEvidence,
  determineGroundingStatus,
  buildRagPrompt,
  DECLINED_DOCUMENT_ONLY_MESSAGE,
  UNTRUSTED_DATA_SECURITY_INSTRUCTION,
  GROUNDING_GUIDELINES_INSTRUCTION,
  UNGROUNDED_FALLBACK_NOTICE,
  MAX_EVIDENCE_CHAR_BUDGET,
  DEFAULT_GROUNDED_SCORE_THRESHOLD,
} from './rag-pipeline.ts';

export type {
  RagPipelineConfig,
  RagPipelineExecutionOptions,
  RagPipelineResult,
} from './rag-pipeline.ts';

export {
  extractMatchedKeywords,
  STATUTORY_REGULATION_DISCLAIMER,
  NEC_KEYWORDS_LIST,
  WATTMONK_KEYWORDS_LIST,
} from './context-detector.ts';

export type {
  ContextRoutingResult,
  ContextRoutingOptions,
  MatchedKeywords,
} from './context-detector.ts';

export {
  CURATED_DOCUMENTS,
  SAMPLE_DISCLAIMER_NOTICE,
  getCuratedDocuments,
  getCuratedChunks,
  isSampleDocument,
  seedCuratedKnowledgeToVectorStore,
} from './curated-knowledge.ts';

export type {
  CuratedDocument,
  CuratedDocumentMetadata,
} from './curated-knowledge.ts';
