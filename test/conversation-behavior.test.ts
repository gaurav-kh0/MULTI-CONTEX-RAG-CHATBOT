import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialState, type ChatState } from '../hooks/useChatState.ts';
import { PUT as putSession } from '../app/api/chat/sessions/[id]/route.ts';
import { chatService } from '../backend/services/chat-service.ts';
import type { ChatSession, ChatMessage, UserChatMessage, AssistantChatMessage, SourceReference } from '../lib/types.ts';

describe('Conversation Behavior - Frontend State & Session Isolation', () => {
  it('maintains separate message lists across different conversations', () => {
    const sessionA: ChatSession = {
      id: 'session_A',
      title: 'Solar Inverter Sizing',
      activeContextScopeIds: ['scope_solar'],
      activeContexts: ['WATTMONK'],
      messages: [
        {
          id: 'msg_a_user_1',
          role: 'user',
          content: 'What is the maximum DC voltage for string inverters?',
          timestamp: '2026-10-18T10:00:00Z',
          contexts: ['WATTMONK'],
        },
        {
          id: 'msg_a_asst_1',
          role: 'assistant',
          content: 'Per NEC 690.7, maximum PV system voltage is typically 600V or 1000V.',
          timestamp: '2026-10-18T10:00:02Z',
          contexts: ['WATTMONK'],
        },
      ],
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:02Z',
    };

    const sessionB: ChatSession = {
      id: 'session_B',
      title: 'NEC Grounding Requirements',
      activeContextScopeIds: ['scope_nec'],
      activeContexts: ['NEC'],
      messages: [
        {
          id: 'msg_b_user_1',
          role: 'user',
          content: 'What does NEC 250 require for grounding electrode conductors?',
          timestamp: '2026-10-18T11:00:00Z',
          contexts: ['NEC'],
        },
      ],
      createdAt: '2026-10-18T11:00:00Z',
      updatedAt: '2026-10-18T11:00:00Z',
    };

    // Initialize state with Session A active
    let state: ChatState = {
      ...initialState,
      activeSessionId: 'session_A',
      sessions: [sessionA, sessionB],
      messages: [...sessionA.messages],
      activeScopeIds: ['scope_solar'],
    };

    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[0].content, 'What is the maximum DC voltage for string inverters?');

    // Switch to Session B
    state = chatReducer(state, { type: 'SELECT_SESSION', payload: 'session_B' });

    assert.equal(state.activeSessionId, 'session_B');
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].content, 'What does NEC 250 require for grounding electrode conductors?');
    // Context scope for Session B was preserved
    assert.deepEqual(state.activeScopeIds, ['scope_nec']);

    // Messages in Session A within state.sessions remain intact and isolated
    const storedSessionA = state.sessions.find((s: ChatSession) => s.id === 'session_A');
    assert.ok(storedSessionA);
    assert.equal(storedSessionA.messages.length, 2);
    assert.equal(storedSessionA.messages[0].id, 'msg_a_user_1');
  });

  it('switches between conversations and preserves outgoing unsynced messages and scopes', () => {
    const session1: ChatSession = {
      id: 'session_1',
      title: 'Session One',
      activeContextScopeIds: ['scope_nec'],
      activeContexts: ['NEC'],
      messages: [],
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:00Z',
    };

    const session2: ChatSession = {
      id: 'session_2',
      title: 'Session Two',
      activeContextScopeIds: ['scope_solar'],
      activeContexts: ['WATTMONK'],
      messages: [],
      createdAt: '2026-10-18T10:05:00Z',
      updatedAt: '2026-10-18T10:05:00Z',
    };

    let state: ChatState = {
      ...initialState,
      activeSessionId: 'session_1',
      sessions: [session1, session2],
      messages: [],
      activeScopeIds: ['scope_nec'],
    };

    const userMsg: UserChatMessage = {
      id: 'msg_u_1',
      role: 'user',
      content: 'Calculate wire sizing for 40A continuous load',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    const asstPlaceholder: AssistantChatMessage = {
      id: 'msg_a_placeholder',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    // User adds message in Session 1
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'Calculate wire sizing for 40A continuous load',
        userMessage: userMsg,
        assistantPlaceholder: asstPlaceholder,
      },
    });

    // Toggle scope in Session 1 to include solar as well
    state = chatReducer(state, { type: 'TOGGLE_SCOPE', payload: 'scope_solar' });
    assert.ok(state.activeScopeIds.includes('scope_solar'));

    // Switch to Session 2
    state = chatReducer(state, { type: 'SELECT_SESSION', payload: 'session_2' });
    assert.equal(state.activeSessionId, 'session_2');
    assert.equal(state.messages.length, 0);
    assert.deepEqual(state.activeScopeIds, ['scope_solar']);

    // Check that session 1 in state.sessions captured the messages and scope updates
    const flushedSession1 = state.sessions.find((s: ChatSession) => s.id === 'session_1');
    assert.ok(flushedSession1);
    assert.equal(flushedSession1.messages.length, 2); // user message + assistant placeholder
    assert.ok(flushedSession1.activeContextScopeIds.includes('scope_solar'));
  });

  it('handles NEW_CHAT cleanly by flushing previous conversation and resetting to empty state', () => {
    const currentSession: ChatSession = {
      id: 'session_existing',
      title: 'Existing Conversation',
      activeContextScopeIds: ['scope_general'],
      activeContexts: ['GENERAL'],
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Hello, what can you do?',
          timestamp: '2026-10-18T10:00:00Z',
          contexts: ['GENERAL'],
        },
      ],
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:00Z',
    };

    let state: ChatState = {
      ...initialState,
      activeSessionId: 'session_existing',
      sessions: [currentSession],
      messages: [...currentSession.messages],
      activeScopeIds: ['scope_general'],
    };

    // Trigger NEW_CHAT
    state = chatReducer(state, { type: 'NEW_CHAT' });

    assert.equal(state.activeSessionId, undefined);
    assert.equal(state.messages.length, 0);
    assert.equal(state.isLoading, false);
    assert.equal(state.error, null);

    // Stored sessions list still retains the previous conversation
    assert.equal(state.sessions.length, 1);
    assert.equal(state.sessions[0].id, 'session_existing');
    assert.equal(state.sessions[0].messages.length, 1);
  });

  it('supports CLEAR_CURRENT_CHAT by clearing messages without deleting the session', () => {
    const session: ChatSession = {
      id: 'session_to_clear',
      title: 'Active Session to Clear',
      activeContextScopeIds: ['scope_nec'],
      activeContexts: ['NEC'],
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          content: 'What is rapid shutdown?',
          timestamp: '2026-10-18T10:00:00Z',
          contexts: ['NEC'],
        },
        {
          id: 'msg_2',
          role: 'assistant',
          content: 'Rapid shutdown is governed by NEC 690.12.',
          timestamp: '2026-10-18T10:00:02Z',
          contexts: ['NEC'],
        },
      ],
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:00:02Z',
    };

    let state: ChatState = {
      ...initialState,
      activeSessionId: 'session_to_clear',
      sessions: [session],
      messages: [...session.messages],
    };

    assert.equal(state.messages.length, 2);

    state = chatReducer(state, { type: 'CLEAR_CURRENT_CHAT' });

    assert.equal(state.messages.length, 0);
    assert.equal(state.activeSessionId, 'session_to_clear');
    assert.equal(state.isLoading, false);
    assert.equal(state.error, null);

    // Session in sessions list also has messages emptied
    const cleared = state.sessions.find((s: ChatSession) => s.id === 'session_to_clear');
    assert.ok(cleared);
    assert.equal(cleared.messages.length, 0);
  });
});

describe('Conversation Behavior - Source Citations & Excerpts Association', () => {
  it('preserves citations strictly with the assistant message that generated them', () => {
    const citationsMsg1: SourceReference[] = [
      {
        documentId: 'doc_nec_690',
        chunkId: 'chunk_nec_1',
        documentTitle: 'NEC 2023 Article 690.12',
        documentName: 'NEC 2023 Codebook',
        snippet: 'Rapid shutdown requirements for PV systems on buildings...',
        contextType: 'NEC',
        score: 0.95,
      },
    ];

    const citationsMsg2: SourceReference[] = [
      {
        documentId: 'doc_solar_sop',
        chunkId: 'chunk_solar_1',
        documentTitle: 'Wattmonk AHJ Approval Checklist',
        documentName: 'Wattmonk Solar Engineering SOP',
        snippet: 'All residential rooftop installations require rapid shutdown initiator...',
        contextType: 'WATTMONK',
        score: 0.91,
      },
    ];

    const assistantMsg1: AssistantChatMessage = {
      id: 'msg_asst_1',
      role: 'assistant',
      content: 'Per NEC 690.12, rapid shutdown must control conductors within 1 foot of the array boundary.',
      timestamp: '2026-10-18T10:00:02Z',
      contexts: ['NEC'],
      citations: citationsMsg1,
      references: citationsMsg1,
    };

    const initialUserMsg: UserChatMessage = {
      id: 'msg_user_1',
      role: 'user',
      content: 'Explain rapid shutdown rules.',
      timestamp: '2026-10-18T10:00:00Z',
      contexts: ['NEC'],
    };

    let state: ChatState = {
      ...initialState,
      messages: [initialUserMsg, assistantMsg1],
    };

    const followUpUserMsg: UserChatMessage = {
      id: 'msg_user_2',
      role: 'user',
      content: 'How does Wattmonk implement this in plan sets?',
      timestamp: '2026-10-18T10:01:00Z',
      contexts: ['WATTMONK'],
    };

    const followUpPlaceholder: AssistantChatMessage = {
      id: 'msg_asst_2',
      role: 'assistant',
      content: '',
      timestamp: '2026-10-18T10:01:01Z',
      contexts: ['WATTMONK'],
    };

    // User asks a follow-up question
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'How does Wattmonk implement this in plan sets?',
        userMessage: followUpUserMsg,
        assistantPlaceholder: followUpPlaceholder,
      },
    });

    // Simulate completion of message 2 with citationsMsg2
    const assistantMsg2: AssistantChatMessage = {
      id: 'msg_asst_2',
      role: 'assistant',
      content: 'Wattmonk includes rapid shutdown labels and disconnect locations on sheet PV-1.',
      timestamp: '2026-10-18T10:01:05Z',
      contexts: ['WATTMONK'],
      citations: citationsMsg2,
      references: citationsMsg2,
    };

    const mockSession: ChatSession = {
      id: 'session_cit',
      title: 'Citations Test',
      activeContextScopeIds: ['scope_nec', 'scope_solar'],
      activeContexts: ['NEC', 'WATTMONK'],
      messages: state.messages,
      createdAt: '2026-10-18T10:00:00Z',
      updatedAt: '2026-10-18T10:01:05Z',
    };

    state = chatReducer(state, {
      type: 'STREAM_SUCCESS',
      payload: {
        assistantMessageId: 'msg_asst_2',
        assistantMessage: assistantMsg2,
        session: mockSession,
      },
    });

    // Verify Message 1 still has only its NEC citations
    const firstAssistantMsg = state.messages.find((m: ChatMessage) => m.id === 'msg_asst_1') as AssistantChatMessage;
    assert.ok(firstAssistantMsg);
    assert.equal(firstAssistantMsg.citations?.length, 1);
    assert.equal(firstAssistantMsg.citations?.[0].documentId, 'doc_nec_690');
    assert.equal(firstAssistantMsg.citations?.[0].contextType, 'NEC');

    // Verify Message 2 has its distinct Wattmonk citations
    const secondAssistantMsg = state.messages.find((m: ChatMessage) => m.id === 'msg_asst_2') as AssistantChatMessage;
    assert.ok(secondAssistantMsg);
    assert.equal(secondAssistantMsg.citations?.length, 1);
    assert.equal(secondAssistantMsg.citations?.[0].documentId, 'doc_solar_sop');
    assert.equal(secondAssistantMsg.citations?.[0].contextType, 'WATTMONK');
  });
});

describe('Conversation Behavior - Duplicate Prevention & Retry Logic', () => {
  it('prevents duplicating user messages when retrying the last request', () => {
    let state = initialState;

    const userMsg: UserChatMessage = {
      id: 'msg_u_retry',
      role: 'user',
      content: 'What is NEC Article 705?',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    const asstPlaceholder: AssistantChatMessage = {
      id: 'msg_a_retry_placeholder',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    // First submission
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'What is NEC Article 705?',
        userMessage: userMsg,
        assistantPlaceholder: asstPlaceholder,
      },
    });

    assert.equal(state.messages.length, 2);
    assert.equal(state.messages[0].role, 'user');
    assert.equal(state.messages[0].content, 'What is NEC Article 705?');
    assert.equal(state.messages[1].role, 'assistant'); // placeholder

    // Simulate an error occurring
    state = chatReducer(state, {
      type: 'STREAM_ERROR',
      payload: {
        assistantMessageId: 'msg_a_retry_placeholder',
        error: 'Provider is currently overloaded. Please retry.',
      },
    });

    assert.equal(state.isLoading, false);
    assert.ok(state.error);

    const retryPlaceholder: AssistantChatMessage = {
      id: 'msg_a_retry_placeholder_2',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    // User clicks Retry (submitting the exact same user message text)
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'What is NEC Article 705?',
        userMessage: userMsg,
        assistantPlaceholder: retryPlaceholder,
      },
    });

    // The user message must NOT be duplicated! Total messages should still be 2 (1 user + 1 assistant placeholder)
    assert.equal(state.messages.length, 2, 'Retry should not duplicate the user message');
    assert.equal(state.messages[0].role, 'user');
    assert.equal(state.messages[0].content, 'What is NEC Article 705?');
    assert.equal(state.messages[1].role, 'assistant');
    assert.equal(state.isLoading, true);
    assert.equal(state.error, null);
  });
});

describe('Conversation Behavior - Stream Cancellation & Loading States', () => {
  it('ensures cancelled streams never leave UI permanently loading and cleans empty placeholders', () => {
    let state = initialState;

    const userMsg: UserChatMessage = {
      id: 'msg_u_cancel',
      role: 'user',
      content: 'Provide complete calculation of voltage drop across 200 feet',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    const asstPlaceholder: AssistantChatMessage = {
      id: 'msg_a_cancel_placeholder',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    // Start stream
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'Provide complete calculation of voltage drop across 200 feet',
        userMessage: userMsg,
        assistantPlaceholder: asstPlaceholder,
      },
    });

    assert.equal(state.isLoading, true);
    assert.equal(state.messages.length, 2);

    // Cancel before receiving any text delta
    state = chatReducer(state, { type: 'CANCEL_REQUEST' });

    assert.equal(state.isLoading, false, 'isLoading must be false after cancellation');
    // The empty assistant placeholder should be cleanly discarded
    assert.equal(state.messages.length, 1, 'Empty placeholder assistant message should be removed');
    assert.equal(state.messages[0].role, 'user');
  });

  it('preserves partial streamed content when cancelled mid-flight without staying loading', () => {
    let state = initialState;

    const userMsg: UserChatMessage = {
      id: 'msg_u_partial',
      role: 'user',
      content: 'Explain inverter derating factors',
      timestamp: new Date().toISOString(),
      contexts: ['WATTMONK'],
    };

    const asstPlaceholder: AssistantChatMessage = {
      id: 'msg_a_partial',
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      contexts: ['WATTMONK'],
    };

    // Start stream
    state = chatReducer(state, {
      type: 'SUBMIT_START',
      payload: {
        rawText: 'Explain inverter derating factors',
        userMessage: userMsg,
        assistantPlaceholder: asstPlaceholder,
      },
    });

    // Receive partial delta
    state = chatReducer(state, {
      type: 'STREAM_DELTA',
      payload: {
        assistantMessageId: 'msg_a_partial',
        text: 'Inverter output derating depends primarily on ambient operating temperature...',
      },
    });

    assert.equal(state.messages.length, 2);
    assert.ok(state.messages[1].content.length > 0);

    // Cancel mid-stream
    state = chatReducer(state, { type: 'CANCEL_REQUEST' });

    assert.equal(state.isLoading, false);
    // Partial content is retained
    assert.equal(state.messages.length, 2);
    assert.equal(
      state.messages[1].content,
      'Inverter output derating depends primarily on ambient operating temperature...'
    );
  });
});

describe('Conversation Behavior - Backend Sessions API', () => {
  it('PUT /api/chat/sessions/[id] with { action: "clear" } resets messages', async () => {
    const session = await chatService.createSession('Test Session To Clear');
    session.messages.push({
      id: 'm1',
      role: 'user',
      content: 'Sample question',
      timestamp: new Date().toISOString(),
      contexts: ['GENERAL'],
    });

    assert.equal(session.messages.length, 1);

    // Call PUT route with action: 'clear'
    const req = new Request(`http://localhost/api/chat/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });

    const res = await putSession(req, { params: { id: session.id } });
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.data.id, session.id);
    assert.equal(json.data.messages.length, 0);

    // Verify directly on service
    const retrieved = await chatService.getSession(session.id);
    assert.ok(retrieved);
    assert.equal(retrieved.messages.length, 0);

    // Cleanup
    await chatService.deleteSession(session.id);
  });

  it('PUT /api/chat/sessions/[id] rejects path traversal and invalid session ids', async () => {
    const maliciousIds = [
      '../../etc/passwd',
      '../sessions',
      'session/with/slashes',
      'invalid$chars!',
      '   ',
    ];

    for (const invalidId of maliciousIds) {
      const req = new Request(`http://localhost/api/chat/sessions/${encodeURIComponent(invalidId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });

      const res = await putSession(req, { params: { id: invalidId } });
      assert.equal(res.status, 400, `Expected 400 for invalid ID: ${invalidId}`);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    }
  });

  it('PUT /api/chat/sessions/[id] returns 404 for non-existent session', async () => {
    const req = new Request('http://localhost/api/chat/sessions/session_nonexistent_99999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });

    const res = await putSession(req, { params: { id: 'session_nonexistent_99999' } });
    assert.equal(res.status, 404);

    const json = await res.json();
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'NOT_FOUND');
  });
});
