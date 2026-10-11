'use client';

import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '@/lib/types';
import { MessageBubble } from './MessageBubble';
import { Bot, AlertCircle, RefreshCw } from 'lucide-react';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function MessageList({
  messages,
  isLoading,
  error,
  onRetry,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, error]);

  return (
    <div
      role="log"
      aria-live="polite"
      aria-label="Conversation message feed"
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}

      {/* Loading State: shown if waiting for first response before assistant message appears */}
      {isLoading && (!messages.length || messages[messages.length - 1]?.role !== 'assistant') && (
        <div className="flex gap-3 max-w-3xl mr-auto animate-in fade-in duration-200" aria-busy="true">
          <div className="w-8 h-8 rounded-xl bg-slate-800 text-indigo-400 border border-slate-700 flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 animate-spin" />
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-400 rounded-tl-sm flex items-center gap-3">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
            </div>
            <span>Searching targeted context spaces & synthesizing response...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="max-w-md mx-auto p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="truncate">{error}</span>
          </div>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] font-medium flex items-center gap-1 transition-colors shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
          )}
        </div>
      )}

      <div ref={bottomRef} className="h-2" />
    </div>
  );
}
