'use client';

import React from 'react';
import { ChatSession } from '@/lib/types';
import { MessageSquare, Trash2, Clock } from 'lucide-react';

interface ConversationHistoryProps {
  sessions: ChatSession[];
  activeSessionId?: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  isCollapsed?: boolean;
}

export function ConversationHistory({
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  isCollapsed = false,
}: ConversationHistoryProps) {
  if (isCollapsed) {
    return (
      <div className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-2">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              aria-label={`Select session: ${session.title}`}
              className={`p-2 rounded-lg transition-colors ${
                isActive
                  ? 'bg-slate-800 text-indigo-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              title={session.title}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          );
        })}
      </div>
    );
  }

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMinutes = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMinutes / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMinutes < 1) return 'Just now';
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 text-[11px] font-semibold tracking-wider uppercase text-slate-500">
        Recent Chats
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500 space-y-1">
            <Clock className="w-4 h-4 mx-auto text-slate-600 mb-1" />
            <p>No chat history yet</p>
            <p className="text-[11px] text-slate-600">Start asking questions below</p>
          </div>
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            return (
              <div
                key={session.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSession(session.id);
                  }
                }}
                aria-pressed={isActive}
                aria-label={`Open conversation: ${session.title}`}
                className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                  isActive
                    ? 'bg-slate-800/90 text-slate-100 border-slate-700 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-6">
                  <MessageSquare
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-400'
                    }`}
                  />
                  <div className="truncate">
                    <p className="truncate leading-snug">{session.title}</p>
                    <span className="text-[10px] text-slate-500 font-normal">
                      {formatRelativeTime(session.updatedAt)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(session.id);
                  }}
                  aria-label={`Delete conversation ${session.title}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-slate-700/60 text-slate-500 hover:text-rose-400 transition-all absolute right-2"
                  title="Delete chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
