/**
 * Server-Sent Events (SSE) Stream Parser
 *
 * Lightweight, zero-dependency parser for OpenAI-compatible streaming endpoints
 * used by OpenRouter and NVIDIA NIM.
 */

export interface OpenAiStreamDelta {
  content?: string;
  role?: string;
}

export interface OpenAiStreamChoice {
  index: number;
  delta: OpenAiStreamDelta;
  finish_reason?: string | null;
}

export interface OpenAiStreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: OpenAiStreamChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Reads a Web API Response ReadableStream and yields parsed JSON SSE chunks.
 * Automatically halts when encountering `data: [DONE]`.
 */
export async function* parseOpenAiSseStream(
  response: Response
): AsyncGenerator<{ json: OpenAiStreamChunk; raw: string }> {
  const body = response.body;
  if (!body) {
    throw new Error('Response body is null or undefined');
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          continue; // SSE comment or ping
        }

        if (trimmed.startsWith('data:')) {
          const dataPayload = trimmed.slice(5).trim();
          if (dataPayload === '[DONE]') {
            return;
          }

          try {
            const parsed = JSON.parse(dataPayload) as OpenAiStreamChunk;
            yield { json: parsed, raw: dataPayload };
          } catch {
            // In case of incomplete line or non-JSON ping, ignore and continue
          }
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const dataPayload = buffer.trim().slice(5).trim();
      if (dataPayload && dataPayload !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataPayload) as OpenAiStreamChunk;
          yield { json: parsed, raw: dataPayload };
        } catch {
          // Ignore trailing invalid fragment
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
