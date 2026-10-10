'use client';

import React from 'react';
import { Database, ShieldCheck } from 'lucide-react';

interface SidebarFooterProps {
  isCollapsed?: boolean;
}

export function SidebarFooter({ isCollapsed = false }: SidebarFooterProps) {
  if (isCollapsed) {
    return (
      <div className="p-3 border-t border-slate-800 flex justify-center text-slate-500">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="p-3 border-t border-slate-800 bg-slate-900/40 text-[11px] text-slate-400 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Database className="w-3.5 h-3.5 text-indigo-400" />
        <span className="font-medium text-slate-300">RAG Ingestion</span>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span>Connected</span>
      </div>
    </div>
  );
}
