'use client';

import React from 'react';
import { useChatState } from '@/hooks/useChatState';
import { AppHeader } from '@/components/layout/AppHeader';
import { CollapsibleSidebar } from '@/components/sidebar/CollapsibleSidebar';
import { ContextSelector } from '@/components/context/ContextSelector';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';

export default function ChatbotPage() {
  const {
    state,
    submitMessage,
    retryLastMessage,
    startNewChat,
    selectSession,
    deleteSession,
    toggleScope,
    selectSuggestedQuestion,
    toggleSidebar,
    setMobileNav,
  } = useChatState();

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-100 overflow-hidden">
      {/* Collapsible Sidebar (Desktop rail + Mobile slide-over drawer) */}
      <CollapsibleSidebar
        sessions={state.sessions}
        activeSessionId={state.activeSessionId}
        isCollapsed={state.isSidebarCollapsed}
        isMobileOpen={state.isMobileNavOpen}
        onToggleCollapse={toggleSidebar}
        onCloseMobile={() => setMobileNav(false)}
        onNewChat={startNewChat}
        onSelectSession={selectSession}
        onDeleteSession={deleteSession}
      />

      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <AppHeader
          onOpenMobileNav={() => setMobileNav(true)}
          onToggleDesktopSidebar={toggleSidebar}
          isSidebarCollapsed={state.isSidebarCollapsed}
          onNewChat={startNewChat}
          activeContextCount={state.activeScopeIds.length}
        />

        {/* Selected Context Bar: Remains visible & changeable during active chat */}
        {state.messages.length > 0 && (
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
            <ContextSelector
              scopes={state.scopes}
              activeScopeIds={state.activeScopeIds}
              onToggleScope={toggleScope}
              compact
            />
          </div>
        )}

        {/* Center Stage: Welcome Screen (empty state) or Message Feed */}
        <main className="flex-1 overflow-y-auto flex flex-col min-h-0 bg-slate-950">
          {state.messages.length === 0 ? (
            <div className="flex-1 overflow-y-auto flex items-center justify-center p-4">
              <WelcomeScreen
                scopes={state.scopes}
                activeScopeIds={state.activeScopeIds}
                onToggleScope={toggleScope}
                onSelectQuestion={selectSuggestedQuestion}
              />
            </div>
          ) : (
            <MessageList
              messages={state.messages}
              isLoading={state.isLoading}
              error={state.error}
              onRetry={retryLastMessage}
            />
          )}
        </main>

        {/* Message Input Bar */}
        <MessageComposer
          scopes={state.scopes}
          activeScopeIds={state.activeScopeIds}
          isLoading={state.isLoading}
          onSendMessage={submitMessage}
        />
      </div>
    </div>
  );
}
