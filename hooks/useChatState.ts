'use client';

import { useReducer, useEffect, useCallback, useRef } from 'react';
import { ChatMessage, ChatSession, ContextScope } from '@/lib/types';
import { INITIAL_CONTEXT_SCOPES } from '@/lib/constants';
import { chatClient } from '@/lib/chat-client';

// ---------------------------------------------------------------------------
// 1. State Model Types
// ---------------------------------------------------------------------------

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId?: string;
  messages: ChatMessage[];
  scopes: ContextScope[];
  activeScopeIds: string[];
  input: string;
  isLoading: boolean;
  error: string | null;
  lastFailedMessage?: string;
  isSidebarCollapsed: boolean;
  isMobileNavOpen: boolean;
}

export type ChatAction =
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SUBMIT_START'; payload: { message: ChatMessage; rawText: string } }
  | {
      type: 'SUBMIT_SUCCESS';
      payload: { assistantMessage: ChatMessage; session: ChatSession };
    }
  | { type: 'SUBMIT_ERROR'; payload: string }
  | { type: 'TOGGLE_SCOPE'; payload: string }
  | { type: 'SET_SCOPES'; payload: ContextScope[] }
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

const initialState: ChatState = {
  sessions: [],
  activeSessionId: undefined,
  messages: [],
  scopes: INITIAL_CONTEXT_SCOPES,
  activeScopeIds: ['scope_nec', 'scope_solar'],
  input: '',
  isLoading: false,
  error: null,
  lastFailedMessage: undefined,
  isSidebarCollapsed: false,
  isMobileNavOpen: false,
};

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'SUBMIT_START':
      return {
        ...state,
        messages: [...state.messages, action.payload.message],
        input: '',
        isLoading: true,
        error: null,
        lastFailedMessage: action.payload.rawText,
      };

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
        const [loadedScopes, loadedSessions] = await Promise.all([
          chatClient.fetchContextScopes().catch(() => INITIAL_CONTEXT_SCOPES),
          chatClient.fetchSessions().catch(() => []),
        ]);

        if (mounted) {
          if (loadedScopes.length > 0) {
            dispatch({ type: 'SET_SCOPES', payload: loadedScopes });
          }
          if (loadedSessions.length > 0) {
            dispatch({ type: 'SET_SESSIONS', payload: loadedSessions });
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

  // Submit Message handler (handles trimmed check, loading check, and optimistic append)
  const submitMessage = useCallback(
    async (rawContent?: string) => {
      const text = (rawContent !== undefined ? rawContent : state.input).trim();

      // Rule 3: Empty messages cannot be submitted
      if (!text) return;

      // Rule 8: Loading state prevents duplicate submissions
      if (state.isLoading) return;

      const currentScopes = activeScopeIdsRef.current;

      // Rule 4: Submitted messages appear in the conversation immediately
      const optimisticMessage: ChatMessage = {
        id: `local_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString(),
        contextScopeIds: currentScopes,
      };

      dispatch({
        type: 'SUBMIT_START',
        payload: { message: optimisticMessage, rawText: text },
      });

      try {
        const result = await chatClient.sendMessage({
          sessionId: state.activeSessionId,
          message: text,
          activeContextScopeIds: currentScopes,
        });

        dispatch({
          type: 'SUBMIT_SUCCESS',
          payload: {
            assistantMessage: result.assistantMessage,
            session: result.session,
          },
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while sending your message.';
        // Rule 9: Errors are displayed clearly and can be retried where appropriate
        dispatch({ type: 'SUBMIT_ERROR', payload: errorMessage });
      }
    },
    [state.input, state.isLoading, state.activeSessionId]
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

  return {
    state,
    setInput,
    submitMessage,
    retryLastMessage,
    startNewChat,
    selectSession,
    deleteSession,
    toggleScope,
    selectSuggestedQuestion,
    toggleSidebar,
    setMobileNav,
  };
}
