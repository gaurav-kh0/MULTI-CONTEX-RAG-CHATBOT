'use client';

import React, { useState } from 'react';
import { CitationSource } from '@/lib/types';
import { FileText, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

interface CitationCardProps {
  citation: CitationSource;
  index: number;
}

export function CitationCard({ citation, index }: CitationCardProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(citation.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const percentageScore = Math.round(citation.score * 100);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-2 text-xs transition-colors hover:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded flex items-center justify-center bg-slate-800 text-[10px] font-mono text-slate-400 shrink-0">
            {index + 1}
          </span>
          <div className="flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-medium text-slate-200 truncate" title={citation.documentTitle || citation.documentName}>
              {citation.documentTitle || citation.documentName || 'Document Reference'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
            {percentageScore}% match
          </span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy citation snippet"
            className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Copy snippet"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <p className={`text-[11px] text-slate-400 leading-relaxed font-mono italic pl-7 ${!isExpanded && 'line-clamp-2'}`}>
        &ldquo;{citation.snippet}&rdquo;
      </p>

      {citation.snippet.length > 120 && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 pl-7 font-medium"
        >
          {isExpanded ? (
            <>
              <span>Show less</span>
              <ChevronUp className="w-3 h-3" />
            </>
          ) : (
            <>
              <span>Show full snippet</span>
              <ChevronDown className="w-3 h-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
