'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ContextScope } from '@/lib/types';
import { Send, Zap, Sun, BookOpen, Sparkles, Loader2 } from 'lucide-react';

interface MessageComposerProps {
  scopes: ContextScope[];
  activeScopeIds: string[];
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  placeholder?: string;
}

export function MessageComposer({
  scopes: _scopes,
  activeScopeIds,
  isLoading,
  onSendMessage,
  placeholder,
}: MessageComposerProps) {
  const [content, setContent] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea as user types
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [content]);

  // Keyboard navigation: Enter sends, Shift+Enter adds newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = content.trim();

    // Prevent submitting empty messages or submitting while loading
    if (!trimmed || isLoading) return;

    onSendMessage(trimmed);
    setContent('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const getScopeMeta = (scopeId: string) => {
    switch (scopeId) {
      case 'scope_nec':
        return { label: 'NEC', icon: Zap, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      case 'scope_solar':
        return { label: 'Wattmonk/Solar', icon: Sun, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
      default:
        return { label: 'General', icon: BookOpen, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
    }
  };

  const defaultPlaceholder =
    activeScopeIds.length === 0
      ? 'Type a question (no context space targeted)...'
      : `Ask a question targeting ${activeScopeIds.length} active context space(s)...`;

  const isSubmitDisabled = !content.trim() || isLoading;

  return (
    <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/60 backdrop-blur shrink-0">
      <div className="max-w-3xl mx-auto space-y-2">
        {/* Active Context Chips Header */}
        <div className="flex items-center justify-between text-[11px] px-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-indigo-400" />
              <span>Targeting Contexts:</span>
            </span>
            {activeScopeIds.length === 0 ? (
              <span className="text-amber-400/90 italic text-[10px]">
                Warning: No context space selected. Please select at least one above.
              </span>
            ) : (
              activeScopeIds.map((scopeId) => {
                const meta = getScopeMeta(scopeId);
                const Icon = meta.icon;
                return (
                  <span
                    key={scopeId}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${meta.color}`}
                  >
                    <Icon className="w-2.5 h-2.5" />
                    <span>{meta.label}</span>
                  </span>
                );
              })
            )}
          </div>
          <span className="hidden sm:inline-flex text-[10px] text-slate-500 items-center gap-1">
            <span>Shift + Enter for new line • Enter to send</span>
          </span>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
          <div className="relative flex-1 rounded-xl bg-slate-950 border border-slate-800 focus-within:border-slate-700 focus-within:ring-2 focus-within:ring-indigo-500/40 transition-all">
            <textarea
              ref={textareaRef}
              rows={1}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder={placeholder || defaultPlaceholder}
              aria-label="Chat message input"
              className="w-full max-h-44 bg-transparent px-4 py-3 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:outline-none disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitDisabled}
            aria-label={isLoading ? 'Sending message...' : 'Send message'}
            className="h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium text-xs transition-all flex items-center justify-center gap-1.5 shrink-0 shadow-sm shadow-indigo-600/20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                <span className="hidden sm:inline">Sending</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Send</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
