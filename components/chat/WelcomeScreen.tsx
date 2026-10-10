'use client';

import React from 'react';
import { ContextScope } from '@/lib/types';
import { SUGGESTED_QUESTIONS, SuggestedQuestion } from '@/lib/constants';
import { ContextSelector } from '@/components/context/ContextSelector';
import { Bot, HelpCircle, ArrowRight, FileCheck } from 'lucide-react';

interface WelcomeScreenProps {
  scopes: ContextScope[];
  activeScopeIds: string[];
  onToggleScope: (id: string) => void;
  onSelectQuestion: (question: string, scopeId?: string) => void;
}

export function WelcomeScreen({
  scopes,
  activeScopeIds,
  onToggleScope,
  onSelectQuestion,
}: WelcomeScreenProps) {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-8 animate-in fade-in duration-300">
      {/* Hero Welcome */}
      <div className="text-center space-y-3">
        <div className="inline-flex p-3 rounded-2xl bg-slate-900 border border-slate-800 text-indigo-400 shadow-md">
          <Bot className="w-8 h-8" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold text-slate-100 tracking-tight">
            Multi-Context RAG Document Assistant
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-lg mx-auto mt-1 leading-relaxed">
            Query across partitioned knowledge scopes with accurate citation retrieval for National
            Electrical Code (NEC), Wattmonk Solar engineering plan sets, and general compliance standards.
          </p>
        </div>
      </div>

      {/* Primary Context Selector */}
      <ContextSelector
        scopes={scopes}
        activeScopeIds={activeScopeIds}
        onToggleScope={onToggleScope}
      />

      {/* Suggested Questions Section */}
      <section aria-label="Suggested Questions" className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
          <HelpCircle className="w-4 h-4 text-indigo-400" />
          <span>Recommended Technical Questions</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {SUGGESTED_QUESTIONS.map((item: SuggestedQuestion) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectQuestion(item.question, item.scopeId)}
              className="group text-left p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between gap-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-medium tracking-wide uppercase px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700/60">
                  {item.badgeLabel}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
              </div>

              <p className="text-xs text-slate-200 group-hover:text-white leading-relaxed font-normal">
                {item.question}
              </p>
            </button>
          ))}
        </div>
      </section>

      {/* Architecture Highlights Note */}
      <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 flex items-start gap-3 text-xs text-slate-400">
        <FileCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-slate-300">Context-Partitioned Retrieval Architecture</p>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Queries are routed and vector-filtered strictly through your selected context spaces,
            preventing irrelevant crosstalk between residential code, utility interconnection, and
            general guidelines.
          </p>
        </div>
      </div>
    </div>
  );
}
