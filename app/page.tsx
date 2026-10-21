'use client';

import React, { useState } from 'react';
import { useChatState } from '@/hooks/useChatState';
import { AppHeader } from '@/components/layout/AppHeader';
import { CollapsibleSidebar } from '@/components/sidebar/CollapsibleSidebar';
import { ContextSelector } from '@/components/context/ContextSelector';
import { WelcomeScreen } from '@/components/chat/WelcomeScreen';
import { MessageList } from '@/components/chat/MessageList';
import { MessageComposer } from '@/components/chat/MessageComposer';
import { DocumentUpload } from '@/components/DocumentUpload';
import { DocumentSearch } from '@/components/DocumentSearch';
import type { ContextType } from '@/lib/types';

export default function ChatbotPage() {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const {
    state,
    submitMessage,
    retryLastMessage,
    cancelCurrentRequest,
    startNewChat,
    clearCurrentChat,
    selectSession,
    deleteSession,
    toggleScope,
    selectSuggestedQuestion,
    toggleSidebar,
    setMobileNav,
    setProvider,
    setModel,
    refreshDocuments,
    setSelectedDocumentId,
    setDocumentOnly,
  } = useChatState();

  const defaultUploadContext: ContextType =
    state.activeScopeIds.includes('scope_solar') && !state.activeScopeIds.includes('scope_nec')
      ? 'WATTMONK'
      : state.activeScopeIds.includes('scope_general') &&
        !state.activeScopeIds.includes('scope_nec') &&
        !state.activeScopeIds.includes('scope_solar')
      ? 'GENERAL'
      : 'NEC';

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
          onClearChat={clearCurrentChat}
          hasMessages={state.messages.length > 0}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          onOpenSearchModal={() => setIsSearchModalOpen(true)}
          activeContextCount={state.activeScopeIds.length}
          providers={state.providers}
          selectedProviderId={state.selectedProviderId}
          selectedModel={state.selectedModel}
          onSelectProvider={setProvider}
          onSelectModel={setModel}
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
              onSelectQuestion={selectSuggestedQuestion}
            />
          )}
        </main>

        {/* Message Input Bar */}
        <MessageComposer
          scopes={state.scopes}
          activeScopeIds={state.activeScopeIds}
          documents={state.documents}
          selectedDocumentId={state.selectedDocumentId}
          onSelectDocument={setSelectedDocumentId}
          documentOnly={state.documentOnly}
          onToggleDocumentOnly={setDocumentOnly}
          isLoading={state.isLoading}
          onSendMessage={submitMessage}
          onCancel={cancelCurrentRequest}
        />
      </div>

      {/* PDF Document Upload Modal */}
      <DocumentUpload
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        defaultContext={defaultUploadContext}
        onUploadSuccess={(payload) => {
          refreshDocuments();
          if (payload?.document?.id) {
            setSelectedDocumentId(payload.document.id);
          }
        }}
      />

      {/* Semantic Document Search Modal */}
      <DocumentSearch
        isOpen={isSearchModalOpen}
        onClose={() => setIsSearchModalOpen(false)}
        defaultContext={defaultUploadContext}
        onAskInChat={(prompt) => submitMessage(prompt)}
      />
    </div>
  );
}
