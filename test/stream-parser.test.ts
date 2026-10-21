import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChatStream,
  StreamInterruptedError,
} from '../lib/stream-parser.ts';
import {
  formatSseEvent,
} from '../lib/stream-protocol.ts';
import type {
  ChatStreamDeltaData,
  ChatStreamDoneData,
  ChatStreamErrorData,
  ChatStreamSessionData,
} from '../lib/stream-protocol.ts';
import type { ChatResponsePayload } from '../lib/types.ts';

// Helper to convert an array of UTF-8 strings into a ReadableStream<Uint8Array>
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('Stream Parser - Protocol & Incremental Processing', () => {
  it('parses session, progressive delta tokens, and done events correctly', async () => {
    const sessionData: ChatStreamSessionData = {
      sessionId: 'sess_123',
      userMessage: {
        id: 'msg_user_1',
        role: 'user',
        content: 'What is NEC 705.12?',
        timestamp: '2026-10-11T12:00:00Z',
        contexts: ['NEC'],
      },
    };

    const delta1: ChatStreamDeltaData = {
      text: 'NEC 705.12 ',
      providerId: 'gemini',
      model: 'gemini-1.5-pro',
    };

    const delta2: ChatStreamDeltaData = {
      text: 'covers point of connection ',
      providerId: 'gemini',
      model: 'gemini-1.5-pro',
    };

    const delta3: ChatStreamDeltaData = {
      text: 'for solar PV systems.',
      providerId: 'gemini',
      model: 'gemini-1.5-pro',
    };

    const doneData: ChatStreamDoneData = {
      sessionId: 'sess_123',
      assistantMessage: {
        id: 'msg_asst_1',
        role: 'assistant',
        content: 'NEC 705.12 covers point of connection for solar PV systems.',
        timestamp: '2026-10-11T12:00:01Z',
        contexts: ['NEC'],
        providerId: 'gemini',
      },
      session: {
        id: 'sess_123',
        title: 'NEC 705.12',
        messages: [],
        activeContexts: ['NEC'],
        activeContextScopeIds: ['scope_nec'],
        createdAt: '2026-10-11T12:00:00Z',
        updatedAt: '2026-10-11T12:00:01Z',
      },
    };

    const sseWireData = [
      formatSseEvent({ type: 'session', data: sessionData }),
      formatSseEvent({ type: 'delta', data: delta1 }),
      formatSseEvent({ type: 'delta', data: delta2 }),
      formatSseEvent({ type: 'delta', data: delta3 }),
      formatSseEvent({ type: 'done', data: doneData }),
    ];

    const stream = createMockStream(sseWireData);

    const receivedSessions: ChatStreamSessionData[] = [];
    const receivedDeltas: string[] = [];
    let receivedDone: ChatStreamDoneData | undefined;

    await parseChatStream(stream, {
      onSession: (data) => receivedSessions.push(data),
      onDelta: (data) => receivedDeltas.push(data.text),
      onDone: (data) => {
        receivedDone = data;
      },
    });

    assert.equal(receivedSessions.length, 1);
    assert.equal(receivedSessions[0].sessionId, 'sess_123');
    assert.deepEqual(receivedDeltas, [
      'NEC 705.12 ',
      'covers point of connection ',
      'for solar PV systems.',
    ]);
    assert.ok(receivedDone);
    assert.equal(
      receivedDone?.assistantMessage.content,
      'NEC 705.12 covers point of connection for solar PV systems.'
    );
  });

  it('handles packet fragmentation across arbitrary chunk boundaries', async () => {
    // Deliberately split lines and tokens across chunks
    const fragmentedChunks = [
      'event: se',
      'ssion\ndata: {"session',
      'Id":"sess_frag","userMessage":{"id":"u1","role":"user","content":"Hi"}}\n\n',
      'event: delta\nda',
      'ta: {"text":"He',
      'llo ","providerId":"mock","model":"mock-v1"}\n\n',
      'event: delta\ndata: {"text":"world!","providerId":"mock","model":"mock-v1"}\n\n',
      'event: do',
      'ne\ndata: {"sessionId":"sess_frag","assistantMessage":{"id":"a1","role":"assistant","content":"Hello world!"},"session":{"id":"sess_frag","title":"T","messages":[],"activeContexts":[]}}\n\n',
    ];

    const stream = createMockStream(fragmentedChunks);

    const deltas: string[] = [];
    let doneCalled = false;

    await parseChatStream(stream, {
      onDelta: (d) => deltas.push(d.text),
      onDone: () => {
        doneCalled = true;
      },
    });

    assert.deepEqual(deltas, ['Hello ', 'world!']);
    assert.equal(doneCalled, true);
  });

  it('handles multiple SSE events packed in a single buffer chunk', async () => {
    const singleChunk =
      'event: delta\ndata: {"text":"A","providerId":"mock","model":"m"}\n\n' +
      'event: delta\ndata: {"text":"B","providerId":"mock","model":"m"}\n\n' +
      'event: done\ndata: {"sessionId":"s","assistantMessage":{"id":"a","role":"assistant","content":"AB"},"session":{"id":"s","title":"T","messages":[],"activeContexts":[]}}\n\n';

    const stream = createMockStream([singleChunk]);

    const collected: string[] = [];
    let done = false;

    await parseChatStream(stream, {
      onDelta: (d) => collected.push(d.text),
      onDone: () => {
        done = true;
      },
    });

    assert.deepEqual(collected, ['A', 'B']);
    assert.equal(done, true);
  });

  it('safely ignores SSE comments and malformed JSON lines without crashing', async () => {
    const noisyChunks = [
      ': ping keepalive comment\n\n',
      'event: delta\ndata: {"text":"Valid 1","providerId":"mock","model":"m"}\n\n',
      ': another comment\n',
      'event: delta\ndata: INVALID_CORRUPT_JSON_DATA_LINE\n\n',
      'event: delta\ndata: {"text":"Valid 2","providerId":"mock","model":"m"}\n\n',
      'event: done\ndata: {"sessionId":"s","assistantMessage":{"id":"a","role":"assistant","content":"Done"},"session":{"id":"s","title":"T","messages":[],"activeContexts":[]}}\n\n',
    ];

    const stream = createMockStream(noisyChunks);

    const deltas: string[] = [];
    let done = false;

    await parseChatStream(stream, {
      onDelta: (d) => deltas.push(d.text),
      onDone: () => {
        done = true;
      },
    });

    assert.deepEqual(deltas, ['Valid 1', 'Valid 2']);
    assert.equal(done, true);
  });
});

describe('Stream Parser - Error & Interruption Handling', () => {
  it('detects interrupted stream when connection closes unexpectedly before done', async () => {
    // Stream terminates after delta without ever sending 'done' or 'error'
    const truncatedStream = createMockStream([
      'event: delta\ndata: {"text":"Partial output...","providerId":"mock","model":"m"}\n\n',
    ]);

    let errorDataReceived: ChatStreamErrorData | undefined;
    let threwInterrupted = false;

    try {
      await parseChatStream(truncatedStream, {
        onError: (err) => {
          errorDataReceived = err;
        },
      });
    } catch (err) {
      if (err instanceof StreamInterruptedError) {
        threwInterrupted = true;
      }
    }

    assert.equal(threwInterrupted, true, 'Should throw StreamInterruptedError');
    assert.ok(errorDataReceived);
    assert.equal(errorDataReceived?.code, 'INTERRUPTED_STREAM');
  });

  it('parses server error events cleanly and invokes onError callback', async () => {
    const errorEventStream = createMockStream([
      'event: error\ndata: {"code":"RATE_LIMIT_ERROR","message":"Upstream rate limit exceeded."}\n\n',
    ]);

    let capturedError: ChatStreamErrorData | undefined;

    await parseChatStream(errorEventStream, {
      onError: (err) => {
        capturedError = err;
      },
    });

    assert.ok(capturedError);
    assert.equal(capturedError?.code, 'RATE_LIMIT_ERROR');
    assert.equal(capturedError?.message, 'Upstream rate limit exceeded.');
  });

  it('handles non_streaming fallback events when provider adapter does not stream', async () => {
    const nonStreamingPayload: ChatResponsePayload = {
      sessionId: 'sess_fallback',
      userMessage: {
        id: 'msg_u',
        role: 'user',
        content: 'Fallback query',
        timestamp: '2026-10-11T12:00:00Z',
        contexts: ['GENERAL'],
      },
      assistantMessage: {
        id: 'msg_a',
        role: 'assistant',
        content: 'Complete response from non-streaming adapter',
        timestamp: '2026-10-11T12:00:01Z',
        contexts: ['GENERAL'],
        providerId: 'mock',
      },
      references: [],
      session: {
        id: 'sess_fallback',
        title: 'Fallback query',
        messages: [],
        activeContexts: ['GENERAL'],
        activeContextScopeIds: ['scope_general'],
        createdAt: '2026-10-11T12:00:00Z',
        updatedAt: '2026-10-11T12:00:01Z',
      },
    };

    const stream = createMockStream([
      formatSseEvent({ type: 'non_streaming', data: nonStreamingPayload }),
    ]);

    let capturedPayload: ChatResponsePayload | undefined;

    await parseChatStream(stream, {
      onNonStreaming: (data) => {
        capturedPayload = data;
      },
    });

    assert.ok(capturedPayload);
    assert.equal(capturedPayload?.sessionId, 'sess_fallback');
    assert.equal(
      capturedPayload?.assistantMessage.content,
      'Complete response from non-streaming adapter'
    );
  });

  it('supports cancellation via AbortSignal without throwing uncaught errors', async () => {
    const controller = new AbortController();

    // Infinite or slow stream simulator
    let canceledReader = false;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"token1"}\n\n'));
      },
      cancel() {
        canceledReader = true;
      },
    });

    const deltas: string[] = [];
    const parsePromise = parseChatStream(
      stream,
      {
        onDelta: (d) => {
          deltas.push(d.text);
          // Abort immediately after first delta
          controller.abort();
        },
      },
      { signal: controller.signal }
    );

    await parsePromise;

    assert.deepEqual(deltas, ['token1']);
    assert.equal(canceledReader, true, 'Underlying stream reader cancel() was called');
  });
});
