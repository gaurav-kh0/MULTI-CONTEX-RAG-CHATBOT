/**
 * Chat Service (Server-Only)
 *
 * Orchestrates multi-context conversation workflows, session storage,
 * and user message processing.
 *
 * NOTICE: External AI LLM generation and vector retrieval are not implemented yet.
 * Unimplemented features return an explicit, documented not-ready response.
 */

import type {
  ChatMessage,
  ChatRequest,
  ChatResponsePayload,
  ChatSession,
  ContextType,
  UserChatMessage,
  AssistantChatMessage,
} from '../../lib/types.ts';

export class ChatService {
  private sessions: Map<string, ChatSession> = new Map();

  constructor() {
    // Seed an initial demo session explicitly marked as a temporary placeholder
    const demoSessionId = 'session_initial_workspace';
    this.sessions.set(demoSessionId, {
      id: demoSessionId,
      title: 'Initial Workspace Chat',
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      activeContexts: ['NEC', 'WATTMONK'],
      messages: [
        {
          id: 'msg_welcome_user',
          role: 'user',
          content: 'Hello, what contexts are available in this assistant?',
          timestamp: new Date(Date.now() - 300000).toISOString(),
          contexts: ['NEC', 'WATTMONK'],
        },
        {
          id: 'msg_welcome_assistant',
          role: 'assistant',
          content:
            '[NOT READY - AI BACKEND UNCONNECTED]\n\n' +
            'Available partitioned contexts are NEC (National Electrical Code), Wattmonk / Solar PV, and General Engineering.\n\n' +
            'The external AI model generation and vector database are not connected yet. ' +
            'No external AI calls were executed for this message.',
          timestamp: new Date(Date.now() - 290000).toISOString(),
          contexts: ['NEC', 'WATTMONK'],
          references: [],
          citations: [],
        },
      ],
      createdAt: new Date(Date.now() - 300000).toISOString(),
      updatedAt: new Date(Date.now() - 290000).toISOString(),
    });
  }

  async listSessions(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async getSession(id: string): Promise<ChatSession | null> {
    return this.sessions.get(id) || null;
  }

  async createSession(title = 'New Multi-Context Chat'): Promise<ChatSession> {
    const session: ChatSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      activeContexts: ['NEC', 'WATTMONK'],
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async processMessage(request: ChatRequest): Promise<ChatResponsePayload> {
    let session: ChatSession | undefined;

    if (request.sessionId) {
      session = this.sessions.get(request.sessionId);
    }

    if (!session) {
      const generatedTitle =
        request.message.length > 40
          ? `${request.message.slice(0, 40)}...`
          : request.message;
      session = await this.createSession(generatedTitle);
    } else if (session.messages.length === 0) {
      session.title =
        request.message.length > 40
          ? `${request.message.slice(0, 40)}...`
          : request.message;
    }

    const contexts: ContextType[] = request.contexts || ['GENERAL'];
    session.activeContexts = contexts;

    const userMessage: UserChatMessage = {
      id: `msg_u_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: request.message,
      timestamp: new Date().toISOString(),
      contexts,
      contextScopeIds: request.activeContextScopeIds,
    };

    session.messages.push(userMessage);

    const contextLabels = contexts.join(', ') || 'GENERAL';

    // Documented not-ready response rather than fabricated AI results
    const assistantMessage: AssistantChatMessage = {
      id: `msg_a_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'assistant',
      content:
        `[NOT READY - AI BACKEND UNCONNECTED]\n\n` +
        `Received query: "${request.message}"\n` +
        `Targeted context partition(s): [${contextLabels}]\n\n` +
        `External AI LLM providers and vector retrieval pipelines are not yet implemented. ` +
        `Zero external AI credentials were used and zero simulated retrieval results were fabricated.`,
      timestamp: new Date().toISOString(),
      contexts,
      contextScopeIds: request.activeContextScopeIds,
      references: [],
      citations: [],
    };

    session.messages.push(assistantMessage);
    session.updatedAt = new Date().toISOString();

    return {
      sessionId: session.id,
      userMessage,
      assistantMessage,
      references: [],
      session,
    };
  }
}

export const chatService = new ChatService();
