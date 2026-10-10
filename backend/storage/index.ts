import {
  ContextDocument,
  DocumentChunk,
  IDocumentStore,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '@/lib/types';

export type { IDocumentStore, IVectorStore };

/**
 * Structural In-Memory Vector Store implementation stub.
 * Database engines (PGVector, ChromaDB, Pinecone, Qdrant) will plug in here.
 */
export class InMemoryVectorStore implements IVectorStore {
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
    _vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    const results: RagRetrievalResult[] = [];
    for (const item of this.chunks.values()) {
      if (
        options?.filterScopeIds &&
        options.filterScopeIds.length > 0 &&
        !options.filterScopeIds.includes(String(item.chunk.metadata.scopeId || ''))
      ) {
        continue;
      }

      results.push({
        chunk: item.chunk,
        score: 1.0,
        documentName: String(item.chunk.metadata.documentName || 'Unknown Document'),
      });

      if (options?.topK && results.length >= options.topK) {
        break;
      }
    }
    return results;
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    for (const [id, item] of this.chunks.entries()) {
      if (item.chunk.documentId === documentId) {
        this.chunks.delete(id);
      }
    }
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
}

export const defaultVectorStore = new InMemoryVectorStore();
export const defaultDocumentStore = new InMemoryDocumentStore();
