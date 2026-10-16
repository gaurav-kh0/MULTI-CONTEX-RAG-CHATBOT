import type {
  ContextDocument,
  ContextType,
  DocumentChunk,
  IDocumentStore,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../../lib/types.ts';
import { PineconeVectorStore, pineconeVectorStore } from './pinecone.ts';

export type { IDocumentStore, IVectorStore };

/**
 * Structural In-Memory Vector Store implementation stub.
 * Database engines (PGVector, ChromaDB, Pinecone, Qdrant) plug into IVectorStore.
 */
export class InMemoryVectorStore implements IVectorStore {
  readonly isPersistent: boolean = false;
  readonly providerName: string = 'in-memory-non-persistent';
  private chunks: Map<string, { chunk: DocumentChunk; vector: number[] }> = new Map();

  async upsertVectors(chunks: DocumentChunk[], vectors: number[][]): Promise<void> {
    chunks.forEach((chunk, index) => {
      this.chunks.set(chunk.id, {
        chunk,
        vector: vectors[index] || [],
      });
    });
  }

  async querySimilar(
    vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    const candidates: RagRetrievalResult[] = [];
    const minThreshold = options?.minScoreThreshold ?? -Infinity;

    for (const item of this.chunks.values()) {
      if (
        options?.filterScopeIds &&
        options.filterScopeIds.length > 0 &&
        !options.filterScopeIds.includes(String(item.chunk.metadata.scopeId || ''))
      ) {
        continue;
      }

      if (
        options?.contexts &&
        options.contexts.length > 0 &&
        !options.contexts.includes(item.chunk.metadata.context as ContextType)
      ) {
        continue;
      }

      if (
        options?.documentId &&
        options.documentId.trim().length > 0 &&
        item.chunk.documentId !== options.documentId.trim()
      ) {
        continue;
      }

      // Compute actual cosine similarity if vectors are present, otherwise 1.0
      let score = 1.0;
      if (
        Array.isArray(vector) &&
        Array.isArray(item.vector) &&
        vector.length > 0 &&
        vector.length === item.vector.length
      ) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vector.length; i++) {
          dot += vector[i] * item.vector[i];
          normA += vector[i] * vector[i];
          normB += item.vector[i] * item.vector[i];
        }
        score = normA > 0 && normB > 0 ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
      }

      if (score < minThreshold) {
        continue;
      }

      candidates.push({
        chunk: item.chunk,
        score,
        documentName: String(item.chunk.metadata.filename || item.chunk.metadata.title || 'Unknown Document'),
        contextType: item.chunk.metadata.context as ContextType,
      });
    }

    // Sort by actual relevance score descending
    candidates.sort((a, b) => b.score - a.score);

    if (options?.topK && options.topK > 0) {
      return candidates.slice(0, options.topK);
    }

    return candidates;
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    for (const [id, item] of this.chunks.entries()) {
      if (item.chunk.documentId === documentId) {
        this.chunks.delete(id);
      }
    }
  }

  clear(): void {
    this.chunks.clear();
  }

  getChunkCount(): number {
    return this.chunks.size;
  }
}

/**
 * Structural In-Memory Document Store implementation stub.
 */
export class InMemoryDocumentStore implements IDocumentStore {
  private documents: Map<string, ContextDocument> = new Map();

  async getDocument(id: string): Promise<ContextDocument | null> {
    return this.documents.get(id) || null;
  }

  async listDocuments(_scopeId?: string): Promise<ContextDocument[]> {
    return Array.from(this.documents.values());
  }

  async saveDocument(doc: ContextDocument): Promise<void> {
    this.documents.set(doc.id, doc);
  }

  async deleteDocument(id: string): Promise<void> {
    this.documents.delete(id);
  }

  clear(): void {
    this.documents.clear();
  }
}

const globalForStorage = globalThis as unknown as {
  inMemoryVectorStore?: InMemoryVectorStore;
  defaultDocumentStore?: InMemoryDocumentStore;
};

export const inMemoryVectorStore =
  globalForStorage.inMemoryVectorStore ?? new InMemoryVectorStore();
export const defaultDocumentStore =
  globalForStorage.defaultDocumentStore ?? new InMemoryDocumentStore();

globalForStorage.inMemoryVectorStore = inMemoryVectorStore;
globalForStorage.defaultDocumentStore = defaultDocumentStore;

/**
 * Resolves active vector store based on VECTOR_STORE_PROVIDER environment setting.
 *
 * Rules:
 * - If VECTOR_STORE_PROVIDER is explicitly 'pinecone', returns Pinecone vector store.
 *   Does NOT silently fallback to in-memory store if credentials are missing;
 *   unconfigured calls throw explicit PineconeStorageError.
 * - If VECTOR_STORE_PROVIDER is explicitly 'memory', returns in-memory vector store.
 * - If unset, prefers Pinecone if configured, otherwise falls back to in-memory store.
 */
export function getActiveVectorStore(): IVectorStore {
  const provider = (process.env.VECTOR_STORE_PROVIDER || '').toLowerCase().trim();

  if (provider === 'pinecone') {
    return pineconeVectorStore;
  }

  if (provider === 'memory') {
    return inMemoryVectorStore;
  }

  if (pineconeVectorStore.isConfigured()) {
    return pineconeVectorStore;
  }

  return inMemoryVectorStore;
}

export const defaultVectorStore: IVectorStore = getActiveVectorStore();

// Re-export Pinecone module
export {
  PineconeVectorStore,
  pineconeVectorStore,
  PineconeStorageError,
  DEFAULT_PINECONE_INDEX_NAME,
  DEFAULT_PINECONE_DIMENSION,
  MAX_PINECONE_BATCH_SIZE,
} from './pinecone.ts';

export type {
  PineconeStoreConfig,
  PineconeIndexStatus,
  PineconeQueryOptions,
  PineconeRecordMetadata,
  PineconeErrorCode,
} from './pinecone.ts';
