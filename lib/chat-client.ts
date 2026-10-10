/**
 * Chat HTTP Client & Service Gateway
 *
 * Encapsulates all HTTP operations between the React UI layer and the Next.js API routes.
 * Uses the shared ApiResponse discriminated unions to provide compile-time safety.
 */

import { ApiResponse, ChatMessage, ChatSession, ContextScope, SendChatMessageRequest } from './types';

export interface SendMessageResponse {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  session: ChatSession;
}

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
}

export const chatClient = new ChatClient();
