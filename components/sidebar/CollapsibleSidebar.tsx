'use client';

import React, { useEffect } from 'react';
import { ChatSession } from '@/lib/types';
import { SidebarHeader } from './SidebarHeader';
import { ConversationHistory } from './ConversationHistory';
import { SidebarFooter } from './SidebarFooter';
import { X } from 'lucide-react';

interface CollapsibleSidebarProps {
  sessions: ChatSession[];
  activeSessionId?: string;
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

export function CollapsibleSidebar({
  sessions,
  activeSessionId,
  isCollapsed,
  isMobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onNewChat,
  onSelectSession,
  onDeleteSession,
}: CollapsibleSidebarProps) {
  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Close sidebar backdrop"
          onClick={onCloseMobile}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              onCloseMobile();
            }
          }}
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden transition-opacity"
        />
      )}

      {/* Mobile Drawer */}
      <aside
        aria-label="Mobile Navigation Sidebar"
        className={`fixed top-0 bottom-0 left-0 w-72 bg-slate-900 border-r border-slate-800 z-50 flex flex-col md:hidden transform transition-transform duration-200 ease-in-out ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="text-sm font-semibold text-slate-100">Menu</div>
          <button
            onClick={onCloseMobile}
            aria-label="Close mobile menu"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <SidebarHeader
          onNewChat={() => {
            onNewChat();
            onCloseMobile();
          }}
          onToggleCollapse={onCloseMobile}
          isCollapsed={false}
        />

        <ConversationHistory
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={(id) => {
            onSelectSession(id);
            onCloseMobile();
          }}
          onDeleteSession={onDeleteSession}
          isCollapsed={false}
        />

        <SidebarFooter isCollapsed={false} />
      </aside>

      {/* Desktop Sidebar */}
      <aside
        aria-label="Application Sidebar"
        className={`hidden md:flex flex-col border-r border-slate-800 bg-slate-900/60 backdrop-blur transition-all duration-200 shrink-0 ${
          isCollapsed ? 'w-16' : 'w-72'
        }`}
      >
        <SidebarHeader
          onNewChat={onNewChat}
          onToggleCollapse={onToggleCollapse}
          isCollapsed={isCollapsed}
        />

        <ConversationHistory
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          isCollapsed={isCollapsed}
        />

        <SidebarFooter isCollapsed={isCollapsed} />
      </aside>
    </>
  );
}
