import {
  AddDocumentRequest,
  ContextDocument,
  ContextScope,
  CreateContextScopeRequest,
  IDocumentStore,
  IVectorStore,
} from '@/lib/types';
import { INITIAL_CONTEXT_SCOPES } from '@/lib/constants';
import { defaultChunker, TextChunker } from '@/backend/rag';
import { defaultDocumentStore, defaultVectorStore } from '@/backend/storage';
import { chatService } from './chat-service.ts';

/**
 * Service managing context scopes, documents, and indexing pipelines.
 */
export class ContextService {
  private scopes: Map<string, ContextScope> = new Map();

  constructor(
    private documentStore: IDocumentStore = defaultDocumentStore,
    private vectorStore: IVectorStore = defaultVectorStore,
    private chunker: TextChunker = defaultChunker
  ) {
    // Initialize default starter context scopes: NEC, Wattmonk/Solar, and General
    for (const scope of INITIAL_CONTEXT_SCOPES) {
      this.scopes.set(scope.id, { ...scope });
    }
  }

  async listScopes(): Promise<ContextScope[]> {
    return Array.from(this.scopes.values());
  }

  async createScope(req: CreateContextScopeRequest): Promise<ContextScope> {
    const scope: ContextScope = {
      id: `scope_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: req.name,
      description: req.description,
      documentIds: [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.scopes.set(scope.id, scope);
    return scope;
  }

  async addDocument(req: AddDocumentRequest): Promise<ContextDocument> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const doc: ContextDocument = {
      id: docId,
      name: req.name,
      sourceType: req.sourceType,
      status: 'indexed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: { scopeId: req.scopeId },
    };

    await this.documentStore.saveDocument(doc);

    // Structural chunking and storage stubs
    if (req.content) {
      const chunks = this.chunker.chunkText(req.content, docId, {
        scopeId: req.scopeId,
        documentName: req.name,
      });
      const mockVectors = chunks.map(() => new Array(1536).fill(0));
      await this.vectorStore.upsertVectors(chunks, mockVectors);
      doc.chunkCount = chunks.length;
    }

    const scope = this.scopes.get(req.scopeId);
    if (scope) {
      scope.documentIds.push(docId);
      scope.updatedAt = new Date().toISOString();
    }

    return doc;
  }
}

export const defaultContextService = new ContextService();

// Authoritative central chat service re-exports
export { ChatService, chatService, chatService as defaultChatService } from './chat-service.ts';
export { documentService, DocumentService } from './document-service.ts';
export { searchService, SearchService } from './search-service.ts';
