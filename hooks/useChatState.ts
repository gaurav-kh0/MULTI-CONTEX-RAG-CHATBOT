'use client';

import { useReducer, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ChatSession, ContextScope, ContextType, ContextDocument } from '../lib/types.ts';
import { INITIAL_CONTEXT_SCOPES } from '../lib/constants.ts';
import { chatClient } from '../lib/chat-client.ts';

// ---------------------------------------------------------------------------
// 1. State Model Types
// ---------------------------------------------------------------------------

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId?: string;
  messages: ChatMessage[];
  scopes: ContextScope[];
  activeScopeIds: string[];
  documents: ContextDocument[];
  selectedDocumentId?: string;
  documentOnly: boolean;
  input: string;
  isLoading: boolean;
  error: string | null;
  lastFailedMessage?: string;
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
}

export type ChatAction =
  | { type: 'SET_INPUT'; payload: string }
  | {
      type: 'SUBMIT_START';
      payload: {
        userMessage: ChatMessage;
        assistantPlaceholder: ChatMessage;
        rawText: string;
      };
    }
  | {
      type: 'STREAM_DELTA';
      payload: { assistantMessageId: string; text: string };
    }
  | {
      type: 'STREAM_SUCCESS';
      payload: {
        assistantMessageId: string;
        assistantMessage: ChatMessage;
        session: ChatSession;
      };
    }
  | {
      type: 'STREAM_ERROR';
      payload: { assistantMessageId?: string; error: string };
    }
  | { type: 'CANCEL_REQUEST' }
  | {
      type: 'SUBMIT_SUCCESS';
      payload: { assistantMessage: ChatMessage; session: ChatSession };
    }
  | { type: 'SUBMIT_ERROR'; payload: string }
  | { type: 'TOGGLE_SCOPE'; payload: string }
  | { type: 'SET_SCOPES'; payload: ContextScope[] }
  | { type: 'SET_DOCUMENTS'; payload: ContextDocument[] }
  | { type: 'SET_SELECTED_DOCUMENT'; payload: string | undefined }
  | { type: 'SET_DOCUMENT_ONLY'; payload: boolean }
  | { type: 'SET_SESSIONS'; payload: ChatSession[] }
  | { type: 'SELECT_SESSION'; payload: string }
  | { type: 'NEW_CHAT'; payload?: { sessionId?: string } }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_MOBILE_NAV'; payload: boolean };

// ---------------------------------------------------------------------------
// 2. Initial State & Reducer
// ---------------------------------------------------------------------------

export const initialState: ChatState = {
  sessions: [],
  activeSessionId: undefined,
  messages: [],
  scopes: INITIAL_CONTEXT_SCOPES,
  activeScopeIds: ['scope_nec', 'scope_solar'],
  documents: [],
  selectedDocumentId: undefined,
  documentOnly: false,
  input: '',
  isLoading: false,
  error: null,
  lastFailedMessage: undefined,
  isSidebarCollapsed: false,
  isMobileNavOpen: false,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'SUBMIT_START':
      return {
        ...state,
        messages: [
          ...state.messages,
          action.payload.userMessage,
          action.payload.assistantPlaceholder,
        ],
        input: '',
        isLoading: true,
        error: null,
        lastFailedMessage: action.payload.rawText,
      };

    case 'STREAM_DELTA': {
      const updatedMessages = state.messages.map((m) =>
        m.id === action.payload.assistantMessageId
          ? { ...m, content: m.content + action.payload.text }
          : m
      );
      return { ...state, messages: updatedMessages };
    }

    case 'STREAM_SUCCESS': {
      const updatedSessions = state.sessions.filter(
        (s) => s.id !== action.payload.session.id
      );
      const updatedMessages = state.messages.map((m) =>
        m.id === action.payload.assistantMessageId
          ? action.payload.assistantMessage
          : m
      );
      return {
        ...state,
        messages: updatedMessages,
        sessions: [action.payload.session, ...updatedSessions],
        activeSessionId: action.payload.session.id,
        isLoading: false,
        error: null,
        lastFailedMessage: undefined,
      };
    }

    case 'STREAM_ERROR': {
      const updatedMessages = state.messages.filter(
        (m) => m.id !== action.payload.assistantMessageId || m.content.length > 0
      );
      return {
        ...state,
        messages: updatedMessages,
        isLoading: false,
        error: action.payload.error,
      };
    }

    case 'CANCEL_REQUEST': {
      const lastMsg = state.messages[state.messages.length - 1];
      const cleanedMessages =
        lastMsg && lastMsg.role === 'assistant' && !lastMsg.content.trim()
          ? state.messages.slice(0, -1)
          : state.messages;
      return {
        ...state,
        messages: cleanedMessages,
        isLoading: false,
      };
    }

    case 'SUBMIT_SUCCESS': {
      const updatedSessions = state.sessions.filter(
        (s) => s.id !== action.payload.session.id
      );
      return {
        ...state,
        messages: [...state.messages, action.payload.assistantMessage],
        sessions: [action.payload.session, ...updatedSessions],
        activeSessionId: action.payload.session.id,
        isLoading: false,
        error: null,
        lastFailedMessage: undefined,
      };
    }

    case 'SUBMIT_ERROR':
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    case 'TOGGLE_SCOPE': {
      const scopeId = action.payload;
      const isAlreadyActive = state.activeScopeIds.includes(scopeId);
      const nextScopeIds = isAlreadyActive
        ? state.activeScopeIds.filter((id) => id !== scopeId)
        : [...state.activeScopeIds, scopeId];
      return { ...state, activeScopeIds: nextScopeIds };
    }

    case 'SET_SCOPES': {
      const activeIds = action.payload
        .filter((s) => s.isActive)
        .map((s) => s.id);
      return {
        ...state,
        scopes: action.payload,
        activeScopeIds: activeIds.length > 0 ? activeIds : state.activeScopeIds,
      };
    }

    case 'SET_DOCUMENTS':
      return { ...state, documents: action.payload };

    case 'SET_SELECTED_DOCUMENT': {
      const docId = action.payload;
      if (!docId || docId === 'all') {
        return { ...state, selectedDocumentId: undefined };
      }
      const targetDoc = state.documents.find((d) => d.id === docId);
      const docContext = (targetDoc?.metadata?.contextType || targetDoc?.metadata?.context) as ContextType | undefined;

      let nextScopeIds = [...state.activeScopeIds];
      if (docContext) {
        const contextToScopeMap: Record<ContextType, string> = {
          NEC: 'scope_nec',
          WATTMONK: 'scope_solar',
          GENERAL: 'scope_general',
        };
        const neededScopeId = contextToScopeMap[docContext];
        if (neededScopeId && !nextScopeIds.includes(neededScopeId)) {
          nextScopeIds = [...nextScopeIds, neededScopeId];
        }
      }

      return {
        ...state,
        selectedDocumentId: docId,
        activeScopeIds: nextScopeIds,
        documentOnly: true,
      };
    }

    case 'SET_DOCUMENT_ONLY':
      return { ...state, documentOnly: action.payload };

    case 'SET_SESSIONS': {
      const sessions = action.payload;
      if (sessions.length > 0 && !state.activeSessionId) {
        const first = sessions[0];
        return {
          ...state,
          sessions,
          activeSessionId: first.id,
          messages: first.messages || [],
          activeScopeIds:
            first.activeContextScopeIds?.length > 0
              ? first.activeContextScopeIds
              : state.activeScopeIds,
        };
      }
      return { ...state, sessions };
    }

    case 'SELECT_SESSION': {
      const session = state.sessions.find((s) => s.id === action.payload);
      if (!session) return state;
      return {
        ...state,
        activeSessionId: session.id,
        messages: session.messages || [],
        activeScopeIds:
          session.activeContextScopeIds && session.activeContextScopeIds.length > 0
            ? session.activeContextScopeIds
            : state.activeScopeIds,
        error: null,
        isMobileNavOpen: false,
      };
    }

    case 'NEW_CHAT':
      return {
        ...state,
        activeSessionId: action.payload?.sessionId || undefined,
        messages: [],
        input: '',
        error: null,
        lastFailedMessage: undefined,
        isMobileNavOpen: false,
      };

    case 'DELETE_SESSION': {
      const remainingSessions = state.sessions.filter(
        (s) => s.id !== action.payload
      );
      const wasActive = state.activeSessionId === action.payload;
      return {
        ...state,
        sessions: remainingSessions,
        ...(wasActive
          ? {
              activeSessionId: undefined,
              messages: [],
              error: null,
            }
          : {}),
      };
    }

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    case 'TOGGLE_SIDEBAR':
      return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed };

    case 'SET_MOBILE_NAV':
      return { ...state, isMobileNavOpen: action.payload };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// 3. Custom Hook: useChatState
// ---------------------------------------------------------------------------

export function useChatState() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const activeScopeIdsRef = useRef(state.activeScopeIds);
  activeScopeIdsRef.current = state.activeScopeIds;

  // Load Context Scopes and Sessions on mount
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const [loadedScopes, loadedSessions, loadedDocs] = await Promise.all([
          chatClient.fetchContextScopes().catch(() => INITIAL_CONTEXT_SCOPES),
          chatClient.fetchSessions().catch(() => []),
          chatClient.fetchDocuments().catch(() => []),
        ]);

        if (mounted) {
          if (loadedScopes.length > 0) {
            dispatch({ type: 'SET_SCOPES', payload: loadedScopes });
          }
          if (loadedSessions.length > 0) {
            dispatch({ type: 'SET_SESSIONS', payload: loadedSessions });
          }
          if (loadedDocs.length > 0) {
            dispatch({ type: 'SET_DOCUMENTS', payload: loadedDocs });
          }
        }
      } catch (err) {
        console.error('Initialization error in useChatState:', err);
      }
    }

    initialize();
    return () => {
      mounted = false;
    };
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up stream reader on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  // Cancellation handler to abort in-flight stream
  const cancelCurrentRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    dispatch({ type: 'CANCEL_REQUEST' });
  }, []);

  // Submit Message handler (handles incremental streaming, abort controller, and progressive updates)
  const submitMessage = useCallback(
    async (rawContent?: string) => {
      const text = (rawContent !== undefined ? rawContent : state.input).trim();

      // Rule 3: Empty messages cannot be submitted
      if (!text) return;

      // Rule 8: Loading state prevents duplicate submissions
      if (state.isLoading) return;

      const currentScopes = activeScopeIdsRef.current;

      // Abort any existing in-flight stream before starting a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const userMessageId = `local_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const assistantMessageId = `streaming_assistant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

      // Rule 4: Submitted messages appear in the conversation immediately
      const optimisticUserMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        contextScopeIds: currentScopes,
      };

      const assistantPlaceholder: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        contextScopeIds: currentScopes,
      };

      dispatch({
        type: 'SUBMIT_START',
        payload: {
          userMessage: optimisticUserMessage,
          assistantPlaceholder,
          rawText: text,
        },
      });

      try {
        const scopeToContextMap: Record<string, ContextType> = {
          scope_nec: 'NEC',
          scope_solar: 'WATTMONK',
          scope_general: 'GENERAL',
        };
        const activeContexts = currentScopes
          .map((id) => scopeToContextMap[id])
          .filter(Boolean) as ContextType[];

        // If a specific document is targeted, ensure its context is present in activeContexts
        if (state.selectedDocumentId) {
          const doc = state.documents.find((d) => d.id === state.selectedDocumentId);
          const docCtx = (doc?.metadata?.contextType || doc?.metadata?.context) as ContextType | undefined;
          if (docCtx && !activeContexts.includes(docCtx)) {
            activeContexts.push(docCtx);
          }
        }

        await chatClient.streamMessage(
          {
            sessionId: state.activeSessionId,
            message: text,
            activeContextScopeIds: currentScopes,
            contexts: activeContexts.length > 0 ? activeContexts : undefined,
            documentId: state.selectedDocumentId && state.selectedDocumentId !== 'all' ? state.selectedDocumentId : undefined,
            documentOnly: state.documentOnly,
          },
          {
            onDelta: (data) => {
              dispatch({
                type: 'STREAM_DELTA',
                payload: {
                  assistantMessageId,
                  text: data.text,
                },
              });
            },
            onDone: (data) => {
              dispatch({
                type: 'STREAM_SUCCESS',
                payload: {
                  assistantMessageId,
                  assistantMessage: data.assistantMessage,
                  session: data.session,
                },
              });
            },
            onError: (errData) => {
              dispatch({
                type: 'STREAM_ERROR',
                payload: {
                  assistantMessageId,
                  error: errData.message,
                },
              });
            },
            onNonStreaming: (payload) => {
              dispatch({
                type: 'STREAM_SUCCESS',
                payload: {
                  assistantMessageId,
                  assistantMessage: payload.assistantMessage,
                  session: payload.session,
                },
              });
            },
          },
          { signal: controller.signal }
        );
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          // Explicitly cancelled by user, state already cleaned up
          return;
        }
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while streaming your message.';
        // Rule 9: Errors are displayed clearly and can be retried where appropriate
        dispatch({
          type: 'STREAM_ERROR',
          payload: { assistantMessageId, error: errorMessage },
        });
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      state.input,
      state.isLoading,
      state.activeSessionId,
      state.selectedDocumentId,
      state.documentOnly,
      state.documents,
    ]
  );

  // Retry the last failed message
  const retryLastMessage = useCallback(() => {
    if (state.lastFailedMessage && !state.isLoading) {
      dispatch({ type: 'CLEAR_ERROR' });
      submitMessage(state.lastFailedMessage);
    }
  }, [state.lastFailedMessage, state.isLoading, submitMessage]);

  // Start New Chat (Rule 7: New Chat clears the current conversation)
  const startNewChat = useCallback(async () => {
    try {
      const newSession = await chatClient.createSession('New Chat');
      dispatch({ type: 'NEW_CHAT', payload: { sessionId: newSession.id } });
    } catch {
      // Local fallback reset
      dispatch({ type: 'NEW_CHAT' });
    }
  }, []);

  // Select a session
  const selectSession = useCallback((sessionId: string) => {
    dispatch({ type: 'SELECT_SESSION', payload: sessionId });
  }, []);

  // Delete a session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await chatClient.deleteSession(sessionId);
        dispatch({ type: 'DELETE_SESSION', payload: sessionId });
      } catch (err) {
        console.error('Failed to delete session:', err);
      }
    },
    []
  );

  // Toggle Context Scope
  const toggleScope = useCallback((scopeId: string) => {
    dispatch({ type: 'TOGGLE_SCOPE', payload: scopeId });
  }, []);

  // Suggested Question Selection
  const selectSuggestedQuestion = useCallback(
    (question: string, scopeId?: string) => {
      if (scopeId && !state.activeScopeIds.includes(scopeId)) {
        dispatch({ type: 'TOGGLE_SCOPE', payload: scopeId });
      }
      submitMessage(question);
    },
    [state.activeScopeIds, submitMessage]
  );

  // Input changes
  const setInput = useCallback((value: string) => {
    dispatch({ type: 'SET_INPUT', payload: value });
  }, []);

  // UI Toggles
  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  }, []);

  const setMobileNav = useCallback((isOpen: boolean) => {
    dispatch({ type: 'SET_MOBILE_NAV', payload: isOpen });
  }, []);

  // Document Management callbacks
  const refreshDocuments = useCallback(async () => {
    try {
      const docs = await chatClient.fetchDocuments();
      dispatch({ type: 'SET_DOCUMENTS', payload: docs });
      return docs;
    } catch (err) {
      console.error('Failed to refresh documents:', err);
      return [];
    }
  }, []);

  const setSelectedDocumentId = useCallback((docId: string | undefined) => {
    dispatch({ type: 'SET_SELECTED_DOCUMENT', payload: docId });
  }, []);

  const setDocumentOnly = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_DOCUMENT_ONLY', payload: enabled });
  }, []);

  return {
    state,
    setInput,
    submitMessage,
    retryLastMessage,
    cancelCurrentRequest,
    startNewChat,
    selectSession,
    deleteSession,
    toggleScope,
    selectSuggestedQuestion,
    toggleSidebar,
    setMobileNav,
    refreshDocuments,
    setSelectedDocumentId,
    setDocumentOnly,
  };
}
