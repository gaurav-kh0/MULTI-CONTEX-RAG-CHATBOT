import {
  AddDocumentRequest,
  ChatMessage,
  ChatSession,
  ContextDocument,
  ContextScope,
  CreateContextScopeRequest,
  IDocumentStore,
  ILlmProvider,
  IVectorStore,
  SendChatMessageRequest,
} from '@/lib/types';
import { INITIAL_CONTEXT_SCOPES } from '@/lib/constants';
import { defaultLlmProvider } from '@/backend/providers';
import { defaultRetriever, defaultChunker, RagRetriever, TextChunker } from '@/backend/rag';
import { defaultDocumentStore, defaultVectorStore } from '@/backend/storage';

/**
 * Service orchestrating multi-context chat workflows.
 * NOTE: Real AI / RAG backend is not connected in this phase.
 * All responses are explicitly marked as temporary stubs and contain zero fake citations.
 */
export class ChatService {
  private sessions: Map<string, ChatSession> = new Map();

  constructor(
    _llmProvider: ILlmProvider = defaultLlmProvider,
    _retriever: RagRetriever = defaultRetriever
  ) {
    // Seed an initial demo session explicitly marked as temporary
    const demoSessionId = 'session_demo_placeholder';
    this.sessions.set(demoSessionId, {
      id: demoSessionId,
      title: 'Sample Workspace Session',
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      messages: [
        {
          id: 'msg_demo_user',
          role: 'user',
          content: 'Hello, how does this multi-context assistant work?',
          timestamp: new Date(Date.now() - 600000).toISOString(),
          contextScopeIds: ['scope_nec', 'scope_solar'],
        },
        {
          id: 'msg_demo_assistant',
          role: 'assistant',
          content:
            '[Temporary Demo Response - Real Backend Not Connected]\n\n' +
            'This assistant partitions queries across selected context spaces (NEC, Wattmonk / Solar, and General).\n\n' +
            'The real AI embedding models, vector store indexing, and document retrieval pipeline will be connected in a future task. ' +
            'No genuine code standards or external documents were queried for this placeholder message.',
          timestamp: new Date(Date.now() - 590000).toISOString(),
          contextScopeIds: ['scope_nec', 'scope_solar'],
          citations: [], // Strictly no fake sources or pretended retrieval results
        },
      ],
      createdAt: new Date(Date.now() - 600000).toISOString(),
      updatedAt: new Date(Date.now() - 590000).toISOString(),
    });
  }

  async listSessions(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async createSession(title = 'New Multi-Context Chat'): Promise<ChatSession> {
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<ChatSession | null> {
    return this.sessions.get(id) || null;
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async processUserMessage(payload: SendChatMessageRequest): Promise<{
    userMessage: ChatMessage;
    assistantMessage: ChatMessage;
    session: ChatSession;
  }> {
    let session: ChatSession | undefined;

    if (payload.sessionId) {
      session = this.sessions.get(payload.sessionId);
    }

    if (!session) {
      session = await this.createSession(
        payload.message.length > 40
          ? `${payload.message.slice(0, 40)}...`
          : payload.message
      );
    } else if (session.messages.length === 0) {
      session.title =
        payload.message.length > 40
          ? `${payload.message.slice(0, 40)}...`
          : payload.message;
    }

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: payload.message,
      timestamp: new Date().toISOString(),
      contextScopeIds: payload.activeContextScopeIds,
    };

    session.messages.push(userMessage);

    const scopeLabels = (payload.activeContextScopeIds || [])
      .map((s) => (s === 'scope_nec' ? 'NEC' : s === 'scope_solar' ? 'Wattmonk/Solar' : 'General'))
      .join(', ') || 'None selected';

    // Temporary stub response explicitly marked - zero fake sources or pretended AI results
    const assistantMessage: ChatMessage = {
      id: `msg_${Date.now()}_a`,
      role: 'assistant',
      content:
        `[Temporary Demo Response - Real Backend Not Connected]\n\n` +
        `Received message: "${payload.message}"\n` +
        `Targeted context scopes: [${scopeLabels}]\n\n` +
        `The real RAG embedding pipeline, vector store retrieval, and LLM provider will be connected in a future task. ` +
        `No genuine AI documents or external knowledge bases were queried.`,
      timestamp: new Date().toISOString(),
      contextScopeIds: payload.activeContextScopeIds,
      citations: [], // Explicitly empty: no fake citations
    };

    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();

    return { userMessage, assistantMessage, session };
  }
}

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

export const defaultChatService = new ChatService();
export const defaultContextService = new ContextService();

export { chatService } from './chat-service.ts';
export { documentService, DocumentService } from './document-service.ts';
export { searchService, SearchService } from './search-service.ts';
