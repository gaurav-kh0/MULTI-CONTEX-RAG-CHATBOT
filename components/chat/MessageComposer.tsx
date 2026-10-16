'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ContextScope, ContextDocument } from '@/lib/types';
import {
  Send,
  Zap,
  Sun,
  BookOpen,
  Sparkles,
  Loader2,
  Square,
  FileText,
  ShieldCheck,
  ShieldAlert,
  X,
} from 'lucide-react';

interface MessageComposerProps {
  scopes: ContextScope[];
  activeScopeIds: string[];
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  documents?: ContextDocument[];
  selectedDocumentId?: string;
  onSelectDocument?: (documentId: string | undefined) => void;
  documentOnly?: boolean;
  onToggleDocumentOnly?: (enabled: boolean) => void;
}

export function MessageComposer({
  scopes: _scopes,
  activeScopeIds,
  isLoading,
  onSendMessage,
  onCancel,
  placeholder,
  documents = [],
  selectedDocumentId,
  onSelectDocument,
  documentOnly = false,
  onToggleDocumentOnly,
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

  const selectedDoc = documents.find((d) => d.id === selectedDocumentId);

  const defaultPlaceholder = selectedDoc
    ? documentOnly
      ? `Ask a question strictly from "${selectedDoc.name}"...`
      : `Ask a question regarding "${selectedDoc.name}"...`
    : activeScopeIds.length === 0
    ? 'Type a question (no context space targeted)...'
    : `Ask a question targeting ${activeScopeIds.length} active context space(s)...`;

  const isSubmitDisabled = !content.trim() || isLoading;

  return (
    <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900/60 backdrop-blur shrink-0">
      <div className="max-w-3xl mx-auto space-y-2.5">
        {/* Active Context Chips Header */}
        <div className="flex items-center justify-between text-[11px] px-1 flex-wrap gap-2">
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

        {/* Document Targeting and Strict Mode Controls */}
        <div className="flex items-center justify-between text-xs px-1 gap-2 flex-wrap">
          {/* Target PDF Selector */}
          <div className="flex items-center gap-1.5 min-w-0 max-w-full">
            <label htmlFor="target-document-select" className="text-slate-400 flex items-center gap-1 text-[11px] shrink-0">
              <FileText className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Target PDF:</span>
            </label>
            <div className="relative inline-flex items-center">
              <select
                id="target-document-select"
                value={selectedDocumentId || 'all'}
                onChange={(e) => {
                  const val = e.target.value;
                  onSelectDocument?.(val === 'all' ? undefined : val);
                }}
                disabled={isLoading}
                className="bg-slate-950 border border-slate-800 text-slate-200 text-[11px] rounded-lg px-2.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 pr-7 truncate max-w-[200px] sm:max-w-[320px] cursor-pointer hover:border-slate-700"
              >
                <option value="all">All Documents in Active Scope</option>
                {documents.map((doc) => {
                  const ctx = (doc.metadata?.contextType || doc.metadata?.context || 'GENERAL') as string;
                  const isUploaded = doc.metadata?.provenance === 'uploaded' || !doc.metadata?.isBuiltInSample;
                  return (
                    <option key={doc.id} value={doc.id}>
                      {isUploaded ? '📄 ' : '📖 '}
                      {doc.name} [{ctx}]
                    </option>
                  );
                })}
              </select>
              {selectedDocumentId && (
                <button
                  type="button"
                  onClick={() => onSelectDocument?.(undefined)}
                  title="Clear document target"
                  className="absolute right-2 text-slate-400 hover:text-rose-400 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Strict PDF Mode Toggle */}
          {onToggleDocumentOnly && (
            <button
              type="button"
              onClick={() => onToggleDocumentOnly(!documentOnly)}
              disabled={isLoading}
              title={
                documentOnly
                  ? 'Strict PDF Only is ACTIVE: Responses strictly derived from indexed PDF. General LLM fallback is disabled.'
                  : 'Strict PDF Only is OFF: If document evidence is missing, model will provide general engineering answers.'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                documentOnly
                  ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-950'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              {documentOnly ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Strict PDF Mode: ON</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
                  <span>Strict PDF Mode: OFF</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Selected Document Indicator Banner */}
        {selectedDoc && (
          <div className="flex items-center justify-between text-[11px] px-2.5 py-1 rounded-lg bg-indigo-950/40 border border-indigo-500/30 text-indigo-200">
            <span className="truncate">
              Targeting: <strong className="text-white">{selectedDoc.name}</strong>
              {documentOnly && (
                <span className="ml-2 text-emerald-400 text-[10px] font-semibold">
                  (Strict Mode: Only this PDF is used)
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onSelectDocument?.(undefined)}
              className="text-slate-400 hover:text-slate-200 ml-2 text-[10px] underline shrink-0"
            >
              Reset to all
            </button>
          </div>
        )}

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

          {isLoading && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Stop generating message"
              className="h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-all flex items-center justify-center gap-1.5 shrink-0 shadow-sm shadow-rose-600/20 focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          ) : (
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
          )}
        </form>
      </div>
    </div>
  );
}
