'use client';

/**
 * DocumentSearch Component
 *
 * Provides a responsive, accessible interface for semantic document search
 * across partitioned knowledge domains (NEC, Wattmonk, General).
 *
 * Features:
 * 1. Semantic search query input with clear button and submission controls.
 * 2. Domain context filter pills (All, NEC, Wattmonk, General).
 * 3. Optional document ID filter and result limit selector (5, 10, 20, 50).
 * 4. Displays ranked chunks with verified metadata:
 *    - Actual similarity score (never fabricated)
 *    - Source filename and title
 *    - Page number badge (only if reliably known, never invented)
 *    - Verbatim excerpt text
 *    - Domain context partition badge
 * 5. Distinct Loading, Empty, and Error states with retry capability.
 * 6. Can be rendered inline or as a modal dialog.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ContextType,
  SearchResultChunk,
  SearchResponsePayload,
  ApiResponse,
} from '@/lib/types';
import {
  Search,
  X,
  Loader2,
  AlertCircle,
  FileText,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  BookOpen,
  Sparkles,
  RefreshCw,
  MessageSquare,
} from 'lucide-react';

export interface DocumentSearchProps {
  /** If provided, renders as a modal overlay; if omitted, renders inline. */
  isOpen?: boolean;
  onClose?: () => void;
  defaultContext?: ContextType;
  onAskInChat?: (prompt: string) => void;
}

const CONTEXT_TABS: Array<{ id: ContextType | 'ALL'; label: string; badge: string }> = [
  { id: 'ALL', label: 'All Contexts', badge: 'NEC • Solar • General' },
  { id: 'NEC', label: 'NEC Code', badge: 'NFPA 70 / Solar' },
  { id: 'WATTMONK', label: 'Wattmonk Solar', badge: 'Standards & Sizing' },
  { id: 'GENERAL', label: 'General Knowledge', badge: 'Standard QA' },
];

const SUGGESTED_QUERIES = [
  'NEC 690 rapid shutdown conductor boundaries',
  'Solar string inverter sizing and DC/AC ratio',
  'Equipment grounding conductor sizing for PV arrays',
  'Energy storage system (ESS) disconnect location NEC 706',
];

export function DocumentSearch({
  isOpen,
  onClose,
  defaultContext,
  onAskInChat,
}: DocumentSearchProps) {
  const isModal = isOpen !== undefined;

  const [query, setQuery] = useState('');
  const [selectedContext, setSelectedContext] = useState<ContextType | 'ALL'>(
    defaultContext ?? 'ALL'
  );
  const [documentId, setDocumentId] = useState('');
  const [limit, setLimit] = useState<number>(10);
  const [minScoreThreshold, setMinScoreThreshold] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Search execution states
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultChunk[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Copied feedback map: chunkId -> boolean
  const [copiedMap, setCopiedMap] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Handle escape key to close modal
  useEffect(() => {
    if (!isModal || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModal, isOpen, onClose]);

  // Execute search request
  const handleSearch = useCallback(
    async (overrideQuery?: string) => {
      const targetQuery = (overrideQuery ?? query).trim();
      if (!targetQuery) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(null);
      setHasSearched(true);

      try {
        const payload: Record<string, unknown> = {
          query: targetQuery,
          limit,
        };

        if (selectedContext !== 'ALL') {
          payload.contexts = [selectedContext];
        }

        if (documentId.trim()) {
          payload.documentId = documentId.trim();
        }

        const parsedThreshold = parseFloat(minScoreThreshold);
        if (!isNaN(parsedThreshold) && Number.isFinite(parsedThreshold)) {
          payload.minScoreThreshold = parsedThreshold;
        }

        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const json: ApiResponse<SearchResponsePayload> = await res.json();

        if (!res.ok || !json.success) {
          const errMessage =
            !json.success && json.error?.message
              ? json.error.message
              : `Search failed with status ${res.status}.`;
          setError(errMessage);
          setResults([]);
          setTotalResults(0);
          return;
        }

        setResults(json.data.results || []);
        setTotalResults(json.data.totalResults ?? json.data.results.length);
        setStatusMessage(json.data.statusMessage || null);
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Network communication error.';
        setError(msg);
        setResults([]);
        setTotalResults(0);
      } finally {
        setIsLoading(false);
      }
    },
    [query, selectedContext, documentId, limit, minScoreThreshold]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  const handleSuggestionClick = (suggested: string) => {
    setQuery(suggested);
    handleSearch(suggested);
  };

  const handleClearQuery = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setError(null);
    searchInputRef.current?.focus();
  };

  const handleCopyExcerpt = async (chunkId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMap((prev) => ({ ...prev, [chunkId]: true }));
      setTimeout(() => {
        setCopiedMap((prev) => ({ ...prev, [chunkId]: false }));
      }, 2000);
    } catch {
      // Ignore clipboard write failures
    }
  };

  const getContextBadgeClasses = (ctx?: ContextType) => {
    switch (ctx) {
      case 'NEC':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'WATTMONK':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      default:
        return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30';
    }
  };

  const content = (
    <div className="flex flex-col h-full max-h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Search className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-100 flex items-center gap-2">
              Semantic Document Search
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                Vector RAG
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Query vector embeddings across partitioned knowledge domains
            </p>
          </div>
        </div>

        {isModal && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Search Input and Filter Bar */}
      <div className="p-4 sm:p-5 border-b border-slate-800/80 bg-slate-950/40 space-y-3">
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search concepts, NEC code articles, solar engineering rules..."
              aria-label="Semantic search query"
              maxLength={1000}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all shadow-inner"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearQuery}
                aria-label="Clear query text"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium transition-colors shadow-sm shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span>Search</span>
          </button>
        </form>

        {/* Context Tabs & Filter Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Context scope filters">
            {CONTEXT_TABS.map((tab) => {
              const active = selectedContext === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedContext(tab.id)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-medium transition-all ${
                    active
                      ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/50 shadow-xs'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 px-2 rounded-md hover:bg-slate-800/60"
            aria-expanded={showAdvanced}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
            <span>Filters</span>
            {showAdvanced ? (
              <ChevronUp className="w-3.5 h-3.5 ml-0.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
            )}
          </button>
        </div>

        {/* Expandable Advanced Filters */}
        {showAdvanced && (
          <div className="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="search-doc-id" className="block text-[11px] font-medium text-slate-400 mb-1">
                Filter by Document ID
              </label>
              <input
                id="search-doc-id"
                type="text"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                placeholder="e.g. doc_1729000000"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label htmlFor="search-limit" className="block text-[11px] font-medium text-slate-400 mb-1">
                Max Results Limit
              </label>
              <select
                id="search-limit"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value={5}>Top 5 chunks</option>
                <option value={10}>Top 10 chunks (Default)</option>
                <option value={20}>Top 20 chunks</option>
                <option value={50}>Top 50 chunks</option>
              </select>
            </div>

            <div>
              <label htmlFor="search-threshold" className="block text-[11px] font-medium text-slate-400 mb-1">
                Relevance Cutoff (0.0 - 1.0)
              </label>
              <input
                id="search-threshold"
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={minScoreThreshold}
                onChange={(e) => setMinScoreThreshold(e.target.value)}
                placeholder="Default: 0.65"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-700/80 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {/* Loading State */}
        {isLoading && (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3" role="status">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-sm font-medium text-slate-200">
              Generating query embedding & searching vector index...
            </p>
            <p className="text-xs text-slate-500 max-w-sm">
              Querying Pinecone vector database with Google text-embedding-004 vectors.
            </p>
          </div>
        )}

        {/* Error State */}
        {!isLoading && error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-500/40 text-red-200 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs space-y-1">
              <p className="font-semibold text-red-300">Search Request Failed</p>
              <p className="text-red-300/90">{error}</p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => handleSearch()}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-red-200 bg-red-900/60 hover:bg-red-900 border border-red-700 px-2.5 py-1 rounded-md transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry Search</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Initial / Idle State */}
        {!isLoading && !hasSearched && !error && (
          <div className="py-8 px-4 flex flex-col items-center text-center space-y-6">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-md">
              <h3 className="text-sm font-semibold text-slate-200">
                Explore Verified Technical Knowledge
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Semantic search finds exact paragraphs and clauses by meaning rather than simple keyword matching.
              </p>
            </div>

            <div className="w-full max-w-lg space-y-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-left">
                Suggested Technical Searches:
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSuggestionClick(q)}
                    className="flex items-center justify-between text-left px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 text-xs text-slate-300 transition-colors group"
                  >
                    <span className="truncate">{q}</span>
                    <Search className="w-3 h-3 text-slate-500 group-hover:text-indigo-400 transition-colors shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty Results State */}
        {!isLoading && hasSearched && !error && results.length === 0 && (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
            <BookOpen className="w-10 h-10 text-slate-600" />
            <h3 className="text-sm font-semibold text-slate-300">
              No Matching Document Chunks Found
            </h3>
            <p className="text-xs text-slate-400 max-w-md leading-relaxed">
              No passages met the relevance threshold in the selected context partition.
              Try adjusting your query phrasing, switching context to &apos;All Contexts&apos;, or lowering the similarity threshold.
            </p>
          </div>
        )}

        {/* Ranked Results Feed */}
        {!isLoading && hasSearched && !error && results.length > 0 && (
          <div className="space-y-3">
            {/* Results count banner */}
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span>
                Found <strong className="text-slate-200">{totalResults}</strong> relevant chunk(s)
                {statusMessage && <span className="ml-1 text-slate-500">({statusMessage})</span>}
              </span>
              <span className="text-[11px] text-slate-500">Ranked by cosine similarity</span>
            </div>

            <div className="space-y-3">
              {results.map((chunk, idx) => {
                const isCopied = copiedMap[chunk.chunkId] || false;
                const formattedScore =
                  typeof chunk.score === 'number' && Number.isFinite(chunk.score)
                    ? chunk.score.toFixed(3)
                    : null;

                return (
                  <article
                    key={chunk.chunkId || `${chunk.documentId}-${idx}`}
                    className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition-colors shadow-sm space-y-2.5"
                  >
                    {/* Card Header: Filename, Page, Context, Score */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-200 truncate" title={chunk.filename}>
                          {chunk.filename}
                        </span>

                        {chunk.pageNumber !== undefined && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono shrink-0">
                            Page {chunk.pageNumber}
                          </span>
                        )}

                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${getContextBadgeClasses(
                            chunk.contextType
                          )}`}
                        >
                          {chunk.contextType}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {formattedScore && (
                          <span
                            className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-medium"
                            title="Actual vector similarity score from Pinecone"
                          >
                            Score: {formattedScore}
                          </span>
                        )}

                        <span className="text-[10px] text-slate-500 font-mono">
                          Chunk #{chunk.chunkIndex}
                        </span>
                      </div>
                    </div>

                    {/* Excerpt Body */}
                    <blockquote className="text-xs text-slate-300 font-mono bg-slate-950/60 p-3 rounded-lg border border-slate-800/70 leading-relaxed whitespace-pre-wrap break-words">
                      {chunk.excerpt}
                    </blockquote>

                    {/* Footer Actions */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-slate-500 font-mono truncate max-w-[200px]" title={chunk.documentId}>
                        Doc ID: {chunk.documentId}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyExcerpt(chunk.chunkId, chunk.excerpt)}
                          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 py-1 px-2 rounded hover:bg-slate-800 transition-colors"
                          title="Copy excerpt text"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>

                        {onAskInChat && (
                          <button
                            type="button"
                            onClick={() => {
                              onAskInChat(
                                `According to ${chunk.filename}${chunk.pageNumber ? ` (page ${chunk.pageNumber})` : ''}, ${chunk.excerpt.slice(0, 150)}... can you explain this in detail?`
                              );
                              if (isModal) onClose?.();
                            }}
                            className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 py-1 px-2 rounded hover:bg-indigo-950/50 transition-colors"
                            title="Ask about this excerpt in chat"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>Ask in Chat</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!isModal) {
    return content;
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Semantic Document Search"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="w-full max-w-3xl overflow-hidden">{content}</div>
    </div>
  );
}
