/**
 * Server-Sent Events (SSE) Stream Protocol Definition
 *
 * Defines the standard streaming wire protocol between the Next.js chat API
 * (/api/chat) and the client interface.
 *
 * PROTOCOL SPECIFICATION:
 * Content-Type: text/event-stream; charset=utf-8
 * Cache-Control: no-cache, no-transform
 * Connection: keep-alive
 *
 * Event Types:
 * 1. event: session
 *    data: { "sessionId": string, "userMessage": UserChatMessage }
 *    Sent immediately after session initialization and user message persistence.
 *
 * 2. event: delta
 *    data: { "text": string, "providerId": ProviderId, "model": string }
 *    Sent progressively as tokens/chunks arrive from the LLM provider.
 *
 * 3. event: done
 *    data: { "sessionId": string, "assistantMessage": AssistantChatMessage, "session": ChatSession }
 *    Sent when the LLM stream completes successfully with full metadata and accounting.
 *
 * 4. event: error
 *    data: { "code": string, "message": string }
 *    Sent when an error occurs during streaming.
 *
 * 5. event: non_streaming
 *    data: ChatResponsePayload
 *    Sent when a provider adapter does not support native streaming,
 *    returning the complete response in a single handled event rather than faking stream chunks.
 */

import type {
  ChatMessage,
  ChatResponsePayload,
  ChatSession,
  ProviderId,
  UserChatMessage,
  AssistantChatMessage,
} from './types.ts';

export type ChatStreamEventType =
  | 'session'
  | 'delta'
  | 'done'
  | 'error'
  | 'non_streaming';

export interface ChatStreamSessionData {
  sessionId: string;
  userMessage: UserChatMessage;
  session?: ChatSession;
}

export interface ChatStreamDeltaData {
  text: string;
  providerId: ProviderId;
  model: string;
}

export interface ChatStreamDoneData {
  sessionId: string;
  assistantMessage: AssistantChatMessage;
  session: ChatSession;
  groundingStatus?: import('./types.ts').GroundingStatus;
  references?: import('./types.ts').SourceReference[];
  citations?: import('./types.ts').SourceReference[];
}

export interface ChatStreamErrorData {
  code: string;
  message: string;
}

export type ChatStreamEvent =
  | { type: 'session'; data: ChatStreamSessionData }
  | { type: 'delta'; data: ChatStreamDeltaData }
  | { type: 'done'; data: ChatStreamDoneData }
  | { type: 'error'; data: ChatStreamErrorData }
  | { type: 'non_streaming'; data: ChatResponsePayload };

/**
 * Formats a typed ChatStreamEvent into SSE wire format.
 */
export function formatSseEvent(event: ChatStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
