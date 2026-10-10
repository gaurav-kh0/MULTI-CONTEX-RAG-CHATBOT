/**
 * Core Domain Contracts and Shared TypeScript Types for Multi-Context RAG Chatbot
 *
 * This module defines shared interfaces, discriminated unions, and domain entities
 * used across both frontend presentation components and backend API layers.
 */

// ---------------------------------------------------------------------------
// 1. Context Types
// ---------------------------------------------------------------------------

export type ContextType = 'NEC' | 'WATTMONK' | 'GENERAL';

export const CONTEXT_TYPES: readonly ContextType[] = ['NEC', 'WATTMONK', 'GENERAL'] as const;

export type ContextSourceType = 'file' | 'url' | 'text' | 'document' | 'manual';
export type DocumentStatus = 'idle' | 'processing' | 'indexed' | 'error';

export interface ContextScope {
  id: string;
  name: string;
  contextType?: ContextType;
  description?: string;
  documentIds: string[];
  isActive?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 2. Providers
// ---------------------------------------------------------------------------

export type ProviderId = 'openai' | 'anthropic' | 'ollama' | 'mock';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'openai',
  'anthropic',
  'ollama',
  'mock',
] as const;

export type LlmProviderType = ProviderId;
export type EmbeddingProviderType = 'openai' | 'ollama' | 'mock';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LlmCompletionResult {
  content: string;
  usage?: TokenUsage;
}

export interface ILlmProvider {
  id: ProviderId;
  name: string;
  generateCompletion(
    prompt: string,
    options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult>;
}

export interface IEmbeddingProvider {
  id: EmbeddingProviderType;
  name: string;
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// 3. Document Metadata & Retrieved Documents
// ---------------------------------------------------------------------------

export interface DocumentMetadata {
  contextType: ContextType;
  title: string;
  sourceUrl?: string;
  mimeType?: string;
  fileSize?: number;
  author?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextDocument {
  id: string;
  name: string;
  sourceType: ContextSourceType;
  status: DocumentStatus;
  size?: number;
  mimeType?: string;
  tokenCount?: number;
  chunkCount?: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Partial<DocumentMetadata> & Record<string, unknown>;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  tokenCount?: number;
}

export interface RetrievedDocument {
  id: string;
  title: string;
  contextType: ContextType;
  content: string;
  score: number; // Normalized relevance / cosine similarity (0.0 to 1.0)
  chunkIndex: number;
  metadata: DocumentMetadata;
}

export interface SourceReference {
  documentId: string;
  documentTitle: string;
  documentName?: string;
  contextType: ContextType;
  snippet: string;
  score: number;
  chunkId: string;
  pageNumber?: number;
  section?: string;
}

// Alias for existing frontend UI compatibility
export type CitationSource = SourceReference;

// ---------------------------------------------------------------------------
// 4. Chat Messages (Discriminated Union by `role`)
// ---------------------------------------------------------------------------

export interface BaseChatMessage {
  id: string;
  content: string;
  timestamp: string;
  contextScopeIds?: string[];
  contexts?: ContextType[];
}

export interface UserChatMessage extends BaseChatMessage {
  role: 'user';
}

export interface AssistantChatMessage extends BaseChatMessage {
  role: 'assistant';
  citations?: SourceReference[];
  references?: SourceReference[];
  providerId?: ProviderId;
  usage?: TokenUsage;
}

export interface SystemChatMessage extends BaseChatMessage {
  role: 'system';
}

export type ChatMessage = UserChatMessage | AssistantChatMessage | SystemChatMessage;
export type MessageRole = ChatMessage['role'];

export interface ChatSession {
  id: string;
  title: string;
  activeContextScopeIds: string[];
  activeContexts?: ContextType[];
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 5. RAG Retrieval Contracts & Storage
// ---------------------------------------------------------------------------

export interface RagQueryOptions {
  topK?: number;
  minScoreThreshold?: number;
  filterScopeIds?: string[];
  contexts?: ContextType[];
}

export interface RagRetrievalResult {
  chunk: DocumentChunk;
  score: number;
  documentName: string;
  contextType?: ContextType;
}

export interface RagSearchResult {
  query: string;
  results: RagRetrievalResult[];
  totalResults: number;
}

export interface IVectorStore {
  upsertVectors(chunks: DocumentChunk[], vectors: number[][]): Promise<void>;
  querySimilar(
    vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]>;
  deleteByDocumentId(documentId: string): Promise<void>;
}

export interface IDocumentStore {
  getDocument(id: string): Promise<ContextDocument | null>;
  listDocuments(scopeId?: string): Promise<ContextDocument[]>;
  saveDocument(doc: ContextDocument): Promise<void>;
  deleteDocument(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 6. API Requests, Responses, and Errors (Discriminated Union)
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorPayload {
  code: ApiErrorCode;
  message: string;
  details?: ApiErrorDetail[];
}

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
  timestamp: string;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

// Dedicated Chat Request & Response contracts
export interface ChatRequest {
  message: string;
  contexts?: ContextType[];
  activeContextScopeIds?: string[];
  sessionId?: string;
  providerId?: ProviderId;
  topK?: number;
}

// Backward-compatible alias
export type SendChatMessageRequest = ChatRequest;

export interface ChatResponsePayload {
  sessionId: string;
  userMessage: UserChatMessage;
  assistantMessage: AssistantChatMessage;
  references: SourceReference[];
  session: ChatSession;
}

export type ChatResponse = ApiResponse<ChatResponsePayload>;

export interface CreateContextScopeRequest {
  name: string;
  description?: string;
  contextType?: ContextType;
}

export interface AddDocumentRequest {
  scopeId: string;
  name: string;
  sourceType: ContextSourceType;
  content?: string;
  contextType?: ContextType;
}

export interface SearchRequest {
  query: string;
  contexts?: ContextType[];
  topK?: number;
}

export interface SearchResponsePayload {
  query: string;
  contexts: ContextType[];
  results: RetrievedDocument[];
  isReady: boolean;
  statusMessage: string;
  totalResults: number;
}

export interface DocumentUploadRequest {
  title: string;
  contextType: ContextType;
  content?: string;
  sourceUrl?: string;
  author?: string;
}

export interface DocumentResponsePayload {
  document: ContextDocument;
  isIndexed: boolean;
  statusMessage: string;
}

// ---------------------------------------------------------------------------
// 7. Compile-Time Type Assertion Helpers
// ---------------------------------------------------------------------------

export type Expect<T extends true> = T;
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;
