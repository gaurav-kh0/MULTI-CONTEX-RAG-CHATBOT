/**
 * Chat HTTP Client & Service Gateway
 *
 * Encapsulates all HTTP operations between the React UI layer and the Next.js API routes.
 * Uses the shared ApiResponse discriminated unions to provide compile-time safety.
 */

import type {
  ApiResponse,
  ChatResponsePayload,
  ChatSession,
  ContextScope,
  SendChatMessageRequest,
} from './types.ts';
import { parseChatStream, type ChatStreamParserCallbacks } from './stream-parser.ts';

export type SendMessageResponse = ChatResponsePayload;

export class ChatClient {
  private baseApiUrl = '/api';

  async fetchContextScopes(): Promise<ContextScope[]> {
    const res = await fetch(`${this.baseApiUrl}/contexts`);
    if (!res.ok) {
      throw new Error(`Failed to load contexts (Status: ${res.status})`);
    }
    const body = (await res.json()) as ApiResponse<ContextScope[]>;
    if (!body.success) {
      throw new Error(body.error.message || 'Invalid context data received.');
    }
    return body.data;
  }

  async fetchDocuments(contextType?: string): Promise<import('./types.ts').ContextDocument[]> {
    const url = contextType
      ? `${this.baseApiUrl}/documents?contextType=${encodeURIComponent(contextType)}`
      : `${this.baseApiUrl}/documents`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load documents (Status: ${res.status})`);
    }
    const body = (await res.json()) as ApiResponse<import('./types.ts').ContextDocument[]>;
    if (!body.success) {
      throw new Error(body.error.message || 'Invalid document data received.');
    }
    return body.data;
  }

  async fetchSessions(): Promise<ChatSession[]> {
    const res = await fetch(`${this.baseApiUrl}/chat/sessions`);
    if (!res.ok) {
      throw new Error(`Failed to load sessions (Status: ${res.status})`);
    }
    const body = (await res.json()) as ApiResponse<ChatSession[]>;
    if (!body.success) {
      throw new Error(body.error.message || 'Invalid session data received.');
    }
    return body.data;
  }

  async createSession(title = 'New Chat'): Promise<ChatSession> {
    const res = await fetch(`${this.baseApiUrl}/chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      throw new Error(`Failed to create new session (Status: ${res.status})`);
    }
    const body = (await res.json()) as ApiResponse<ChatSession>;
    if (!body.success) {
      throw new Error(body.error.message || 'Failed to initialize session.');
    }
    return body.data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.baseApiUrl}/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error(`Failed to delete session (Status: ${res.status})`);
    }
  }

  async sendMessage(payload: SendChatMessageRequest): Promise<SendMessageResponse> {
    const res = await fetch(`${this.baseApiUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as ApiResponse<SendMessageResponse>;

    if (!res.ok || !body.success) {
      const errorMessage = !body.success
        ? body.error.message
        : `Chat API error (${res.status}): ${res.statusText}`;
      throw new Error(errorMessage);
    }

    return body.data;
  }

  /**
   * Executes streaming chat message request using native Web Streams and SSE.
   * Handles progressive chunk reading, cancellation, and non-streaming fallbacks.
   */
  async streamMessage(
    payload: SendChatMessageRequest,
    callbacks: ChatStreamParserCallbacks,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const res = await fetch(`${this.baseApiUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: options?.signal,
    });

    if (!res.ok) {
      let errorMessage = `Chat API error (${res.status}): ${res.statusText}`;
      try {
        const body = (await res.json()) as ApiResponse<unknown>;
        if (!body.success && body.error?.message) {
          errorMessage = body.error.message;
        }
      } catch {
        // Fallback to status text
      }
      callbacks.onError?.({ code: `HTTP_${res.status}`, message: errorMessage });
      throw new Error(errorMessage);
    }

    const contentType = res.headers.get('content-type') || '';

    // If server responded with SSE stream
    if (contentType.includes('text/event-stream')) {
      if (!res.body) {
        throw new Error('Response body stream is not available');
      }
      await parseChatStream(res.body, callbacks, { signal: options?.signal });
      return;
    }

    // Handled non-streaming fallback: if adapter does not support streaming
    if (contentType.includes('application/json')) {
      const body = (await res.json()) as ApiResponse<ChatResponsePayload>;
      if (!body.success) {
        throw new Error(body.error.message || 'Error occurred during generation.');
      }

      callbacks.onSession?.({
        sessionId: body.data.session.id,
        userMessage: body.data.userMessage,
        session: body.data.session,
      });
      callbacks.onNonStreaming?.(body.data);
      callbacks.onDone?.({
        sessionId: body.data.session.id,
        assistantMessage: body.data.assistantMessage,
        session: body.data.session,
      });
      return;
    }

    throw new Error(`Unsupported response Content-Type: ${contentType}`);
  }
}

export const chatClient = new ChatClient();
