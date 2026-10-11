/**
 * Server-Sent Events (SSE) Stream Parser
 *
 * Incremental, zero-dependency parser for ChatStreamEvent streams over native Web Streams.
 * Independently testable and works in both Browser and Node.js runtimes.
 *
 * Features:
 * - Reads chunks progressively without buffering the entire stream.
 * - Handles split packet boundaries and multi-line event payloads.
 * - Gracefully tolerates malformed JSON and SSE comments.
 * - Detects interrupted connections before completion.
 * - Supports cancellation via AbortSignal with proper resource cleanup.
 */

import type {
  ChatStreamEvent,
  ChatStreamEventType,
  ChatStreamSessionData,
  ChatStreamDeltaData,
  ChatStreamDoneData,
  ChatStreamErrorData,
} from './stream-protocol.ts';
import type { ChatResponsePayload } from './types.ts';

export interface ChatStreamParserCallbacks {
  onSession?: (data: ChatStreamSessionData) => void;
  onDelta?: (data: ChatStreamDeltaData) => void;
  onDone?: (data: ChatStreamDoneData) => void;
  onError?: (data: ChatStreamErrorData) => void;
  onNonStreaming?: (data: ChatResponsePayload) => void;
}

export interface ParseChatStreamOptions {
  signal?: AbortSignal;
}

export class StreamInterruptedError extends Error {
  constructor(message = 'Stream connection was closed before completion.') {
    super(message);
    this.name = 'StreamInterruptedError';
  }
}

/**
 * Parses an incoming ReadableStream of UTF-8 encoded bytes according to the ChatStreamEvent protocol.
 */
export async function parseChatStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: ChatStreamParserCallbacks,
  options?: ParseChatStreamOptions
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let currentEventType: ChatStreamEventType = 'delta';
  let isCompleted = false;
  let hasError = false;

  const onAbort = () => {
    try {
      reader.cancel();
    } catch {
      // Ignored
    }
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      reader.releaseLock();
      return;
    }
    options.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    while (true) {
      if (options?.signal?.aborted) {
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      // Keep any trailing incomplete fragment in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines or SSE comments (: ping)
        if (!trimmed || trimmed.startsWith(':')) {
          continue;
        }

        if (trimmed.startsWith('event:')) {
          const typeStr = trimmed.slice(6).trim() as ChatStreamEventType;
          currentEventType = typeStr;
          continue;
        }

        if (trimmed.startsWith('data:')) {
          const rawData = trimmed.slice(5).trim();
          if (!rawData) continue;

          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(rawData);
          } catch {
            // Tolerate malformed JSON fragments without crashing the parser
            continue;
          }

          switch (currentEventType) {
            case 'session':
              callbacks.onSession?.(parsedJson as ChatStreamSessionData);
              break;

            case 'delta':
              callbacks.onDelta?.(parsedJson as ChatStreamDeltaData);
              break;

            case 'done':
              isCompleted = true;
              callbacks.onDone?.(parsedJson as ChatStreamDoneData);
              break;

            case 'error':
              hasError = true;
              callbacks.onError?.(parsedJson as ChatStreamErrorData);
              break;

            case 'non_streaming':
              isCompleted = true;
              callbacks.onNonStreaming?.(parsedJson as ChatResponsePayload);
              break;

            default:
              // Fallback to delta if unrecognized event type
              callbacks.onDelta?.(parsedJson as ChatStreamDeltaData);
              break;
          }

          // Reset to default event type for subsequent messages
          currentEventType = 'delta';
        }
      }
    }

    // Flush any trailing buffer line
    if (buffer.trim().startsWith('data:')) {
      const rawData = buffer.trim().slice(5).trim();
      try {
        const parsedJson = JSON.parse(rawData);
        if (currentEventType === 'done') {
          isCompleted = true;
          callbacks.onDone?.(parsedJson as ChatStreamDoneData);
        } else if (currentEventType === 'error') {
          hasError = true;
          callbacks.onError?.(parsedJson as ChatStreamErrorData);
        } else if (currentEventType === 'non_streaming') {
          isCompleted = true;
          callbacks.onNonStreaming?.(parsedJson as ChatResponsePayload);
        }
      } catch {
        // Ignore trailing incomplete fragment
      }
    }

    // If stream terminated without reaching done, error, or cancellation, report interruption
    if (!isCompleted && !hasError && !options?.signal?.aborted) {
      const interruptError: ChatStreamErrorData = {
        code: 'INTERRUPTED_STREAM',
        message: 'The streaming connection was closed unexpectedly before completion.',
      };
      callbacks.onError?.(interruptError);
      throw new StreamInterruptedError();
    }
  } finally {
    if (options?.signal) {
      options.signal.removeEventListener('abort', onAbort);
    }
    reader.releaseLock();
  }
}
