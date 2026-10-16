'use client';

import React, { useState } from 'react';
import type { SourceReference } from '@/lib/types';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  FileText,
  Hash,
  Layers,
  Sparkles,
} from 'lucide-react';

export interface SourcePanelProps {
  sources?: SourceReference[];
  citations?: SourceReference[];
  messageId?: string;
  defaultExpanded?: boolean;
  className?: string;
}

interface CitationItemProps {
  source: SourceReference;
  index: number;
  messageId: string;
}

function CitationItem({ source, index, messageId }: CitationItemProps) {
  const [copied, setCopied] = useState(false);
  const [isExcerptExpanded, setIsExcerptExpanded] = useState(false);

  const excerptText = (source.snippet || source.excerpt || '').trim();
  const hasExcerpt = excerptText.length > 0;

  // Verified display name: filename -> documentName -> documentTitle -> documentId
  const displayName =
    source.filename ||
    source.documentName ||
    source.documentTitle ||
    source.documentId;

  // Reliably known page number check
  const hasVerifiedPageNumber =
    typeof source.pageNumber === 'number' &&
    Number.isInteger(source.pageNumber) &&
    source.pageNumber > 0;

  // Verified retrieval score check (only if supplied by vector DB)
  const hasVerifiedScore =
    typeof source.score === 'number' && Number.isFinite(source.score);

  const handleCopyExcerpt = async () => {
    if (!hasExcerpt) return;
    try {
      await navigator.clipboard.writeText(excerptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const itemId = `citation-${messageId}-${index}`;

  return (
    <article
      id={itemId}
      aria-label={`Citation ${index + 1}: ${displayName}`}
      className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2.5 text-xs transition-colors hover:border-slate-700 focus-within:border-indigo-500/50"
    >
      {/* Header Row: Document Name & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-5 h-5 rounded flex items-center justify-center bg-slate-800/90 text-[10px] font-mono text-slate-400 shrink-0 border border-slate-700/60"
            aria-hidden="true"
          >
            {index + 1}
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
            <span
              className="font-medium text-slate-200 truncate"
              title={displayName}
            >
              {displayName}
            </span>
          </div>
        </div>

        {/* Copy Excerpt Button if excerpt exists */}
        {hasExcerpt && (
          <div className="flex items-center self-end sm:self-auto shrink-0">
            <button
              type="button"
              onClick={handleCopyExcerpt}
              aria-label={`Copy excerpt from ${displayName}`}
              className="p-1 px-1.5 rounded inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-indigo-500"
              title="Copy excerpt"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                  <span className="text-emerald-400 font-medium text-[10px]">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-400" aria-hidden="true" />
                  <span className="text-[10px]">Copy</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Verified Metadata Badges (Only displayed if verified; NEVER fabricated) */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px]">
        {/* Document ID */}
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-400"
          title={`Document ID: ${source.documentId}`}
        >
          <Hash className="w-2.5 h-2.5 text-slate-500" aria-hidden="true" />
          <span className="truncate max-w-[140px] sm:max-w-[200px]">{source.documentId}</span>
        </span>

        {/* Chunk Identifier */}
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-mono text-slate-400"
          title={`Chunk Identifier: ${source.chunkId}`}
        >
          <Layers className="w-2.5 h-2.5 text-slate-500" aria-hidden="true" />
          <span className="truncate max-w-[120px] sm:max-w-[180px]">{source.chunkId}</span>
        </span>

        {/* Page Number (Only if reliably known; never invented) */}
        {hasVerifiedPageNumber && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium font-mono"
            title={`Verified Page Number: ${source.pageNumber}`}
          >
            <span>Page {source.pageNumber}</span>
          </span>
        )}

        {/* Raw Retrieval Similarity Score (Only if supplied by vector DB; no fake confidence %) */}
        {hasVerifiedScore && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium font-mono"
            title={`Vector Similarity Score: ${source.score!.toFixed(4)}`}
          >
            <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
            <span>Score: {source.score!.toFixed(3)}</span>
          </span>
        )}

        {/* Context Type if present */}
        {source.contextType && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium uppercase text-[9px]"
            title={`Context Partition: ${source.contextType}`}
          >
            {source.contextType}
          </span>
        )}
      </div>

      {/* Optional Short Supporting Excerpt (Safely rendered text) */}
      {hasExcerpt && (
        <div className="pt-1">
          <blockquote className="text-[11px] text-slate-400 leading-relaxed font-mono italic pl-2 border-l-2 border-slate-700/80">
            <p className={!isExcerptExpanded && excerptText.length > 150 ? 'line-clamp-2' : ''}>
              &ldquo;{excerptText}&rdquo;
            </p>
          </blockquote>

          {excerptText.length > 150 && (
            <button
              type="button"
              onClick={() => setIsExcerptExpanded(!isExcerptExpanded)}
              aria-expanded={isExcerptExpanded}
              aria-label={
                isExcerptExpanded
                  ? `Show less excerpt from ${displayName}`
                  : `Show full excerpt from ${displayName}`
              }
              className="mt-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 focus:outline-hidden focus-visible:underline"
            >
              {isExcerptExpanded ? (
                <>
                  <span>Show less</span>
                  <ChevronUp className="w-3 h-3" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>Show full excerpt</span>
                  <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </>
              )}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function SourcePanel({
  sources,
  citations,
  messageId = 'default',
  defaultExpanded = false,
  className = '',
}: SourcePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Support both sources and citations props
  const rawSources = sources || citations || [];
  const validSources = rawSources.filter((s) => s && Boolean(s.documentId || s.chunkId));

  if (validSources.length === 0) {
    return null;
  }

  const panelId = `sources-panel-${messageId}`;
  const buttonId = `sources-button-${messageId}`;

  return (
    <div
      className={`rounded-xl bg-slate-900/70 border border-slate-800/90 overflow-hidden text-slate-200 mt-2 transition-all ${className}`}
    >
      {/* Expand/Collapse Header Button */}
      <button
        type="button"
        id={buttonId}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        aria-label={
          isExpanded
            ? `Collapse ${validSources.length} source citation${validSources.length === 1 ? '' : 's'}`
            : `Expand ${validSources.length} source citation${validSources.length === 1 ? '' : 's'}`
        }
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-2.5 px-3 hover:bg-slate-800/50 transition-colors text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-300">
            Retrieved Sources
          </span>
          <span
            className="inline-flex items-center justify-center px-1.5 py-0.2 rounded-full text-[10px] font-mono font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
            title={`${validSources.length} verified source citations`}
          >
            {validSources.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="text-[10px] font-medium hidden sm:inline">
            {isExpanded ? 'Hide sources' : 'Show sources'}
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden="true" />
          )}
        </div>
      </button>

      {/* Expandable Citations Region */}
      {isExpanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="p-3 pt-1 border-t border-slate-800/60 space-y-2.5 bg-slate-950/40"
        >
          {validSources.map((source, idx) => (
            <CitationItem
              key={`${source.documentId}_${source.chunkId}_${idx}`}
              source={source}
              index={idx}
              messageId={messageId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default SourcePanel;
