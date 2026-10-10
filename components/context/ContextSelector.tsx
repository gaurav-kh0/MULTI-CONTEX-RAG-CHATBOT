'use client';

import React from 'react';
import { ContextScope } from '@/lib/types';
import { Zap, Sun, BookOpen, Check, Layers } from 'lucide-react';

interface ContextSelectorProps {
  scopes: ContextScope[];
  activeScopeIds: string[];
  onToggleScope: (id: string) => void;
  compact?: boolean;
}

export function ContextSelector({
  scopes,
  activeScopeIds,
  onToggleScope,
  compact = false,
}: ContextSelectorProps) {
  const getContextMeta = (scopeId: string) => {
    switch (scopeId) {
      case 'scope_nec':
        return {
          icon: Zap,
          badge: 'NEC NFPA 70',
          activeBg: 'bg-amber-500/10 border-amber-500/40 text-amber-300',
          accentText: 'text-amber-400',
          dotBg: 'bg-amber-400',
        };
      case 'scope_solar':
        return {
          icon: Sun,
          badge: 'Wattmonk / Solar',
          activeBg: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300',
          accentText: 'text-emerald-400',
          dotBg: 'bg-emerald-400',
        };
      default:
        return {
          icon: BookOpen,
          badge: 'General',
          activeBg: 'bg-blue-500/10 border-blue-500/40 text-blue-300',
          accentText: 'text-blue-400',
          dotBg: 'bg-blue-400',
        };
    }
  };

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Context Filters">
        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1.5 mr-1">
          <Layers className="w-3.5 h-3.5 text-slate-500" />
          <span>Active Context:</span>
        </span>
        {scopes.map((scope) => {
          const isActive = activeScopeIds.includes(scope.id);
          const meta = getContextMeta(scope.id);
          const Icon = meta.icon;

          return (
            <button
              key={scope.id}
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => onToggleScope(scope.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                isActive
                  ? `${meta.activeBg} shadow-xs`
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
              }`}
            >
              <Icon className={`w-3 h-3 ${isActive ? meta.accentText : 'text-slate-500'}`} />
              <span>{scope.name}</span>
              {isActive && <Check className="w-3 h-3 ml-0.5" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section
      aria-label="Target Knowledge Contexts"
      className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Multi-Context Knowledge Selector
          </h2>
        </div>
        <span className="text-[11px] text-slate-400">
          <span className="font-semibold text-slate-200">{activeScopeIds.length}</span> of{' '}
          {scopes.length} selected
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {scopes.map((scope) => {
          const isActive = activeScopeIds.includes(scope.id);
          const meta = getContextMeta(scope.id);
          const Icon = meta.icon;

          return (
            <button
              key={scope.id}
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => onToggleScope(scope.id)}
              className={`text-left p-3 rounded-lg border transition-all flex flex-col justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                isActive
                  ? `bg-slate-800/90 border-slate-700 shadow-sm ${meta.activeBg}`
                  : 'bg-slate-900/80 border-slate-800/90 text-slate-400 hover:border-slate-700 hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-md ${
                      isActive ? 'bg-slate-800' : 'bg-slate-800/60 text-slate-500'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? meta.accentText : 'text-slate-400'}`} />
                  </div>
                  <span className={`text-xs font-semibold ${isActive ? 'text-slate-100' : 'text-slate-300'}`}>
                    {scope.name}
                  </span>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-500 text-white'
                      : 'border-slate-600 bg-slate-800'
                  }`}
                >
                  {isActive && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                </div>
              </div>

              {scope.description && (
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                  {scope.description}
                </p>
              )}

              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800/60 w-full">
                <span>{meta.badge}</span>
                <span className="font-mono">{scope.documentIds.length} doc(s)</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
