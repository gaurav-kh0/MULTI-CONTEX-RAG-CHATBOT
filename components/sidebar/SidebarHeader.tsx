'use client';

import React from 'react';
import { Layers, Plus, PanelLeftClose } from 'lucide-react';

interface SidebarHeaderProps {
  onNewChat: () => void;
  onToggleCollapse: () => void;
  isCollapsed?: boolean;
}

export function SidebarHeader({
  onNewChat,
  onToggleCollapse,
  isCollapsed = false,
}: SidebarHeaderProps) {
  if (isCollapsed) {
    return (
      <div className="p-3 flex flex-col items-center gap-3 border-b border-slate-800">
        <button
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          title="Expand sidebar"
        >
          <Layers className="w-5 h-5 text-indigo-400" />
        </button>
        <button
          onClick={onNewChat}
          aria-label="New chat"
          className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          title="New chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 border-b border-slate-800 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700/80 flex items-center justify-center text-indigo-400 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-100 tracking-tight">
              Multi-Context RAG
            </h1>
            <p className="text-[11px] text-slate-400">Document Assistant</p>
          </div>
        </div>
        <button
          onClick={onToggleCollapse}
          aria-label="Collapse sidebar"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
          title="Collapse sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <button
        onClick={onNewChat}
        aria-label="Start a new chat conversation"
        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700/80 border border-slate-700 text-xs font-medium text-slate-200 hover:text-white transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <Plus className="w-3.5 h-3.5 text-indigo-400" />
        <span>New Chat</span>
      </button>
    </div>
  );
}
