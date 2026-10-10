'use client';

import React from 'react';
import { Menu, Plus, PanelLeftOpen, Layers, ShieldCheck } from 'lucide-react';

interface AppHeaderProps {
  onOpenMobileNav: () => void;
  onToggleDesktopSidebar: () => void;
  isSidebarCollapsed: boolean;
  onNewChat: () => void;
  activeContextCount: number;
}

export function AppHeader({
  onOpenMobileNav,
  onToggleDesktopSidebar,
  isSidebarCollapsed,
  onNewChat,
  activeContextCount,
}: AppHeaderProps) {
  return (
    <header className="h-14 border-b border-slate-800 bg-slate-900/60 backdrop-blur px-4 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-2.5">
        {/* Mobile Hamburger */}
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation sidebar"
          className="md:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Desktop Sidebar Expand toggle when collapsed */}
        {isSidebarCollapsed && (
          <button
            type="button"
            onClick={onToggleDesktopSidebar}
            aria-label="Expand sidebar"
            className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-slate-800 border border-slate-700/80 flex items-center justify-center text-indigo-400">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-xs sm:text-sm font-semibold text-slate-100 leading-tight flex items-center gap-2">
              Multi-Context RAG
              <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                NEC • Solar • General
              </span>
            </h1>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-300 bg-slate-800/60 border border-slate-700/60 px-2.5 py-1 rounded-lg">
          <span className="text-slate-500">Contexts:</span>
          <span className="font-semibold text-indigo-400">{activeContextCount} active</span>
        </div>

        <button
          type="button"
          onClick={onNewChat}
          aria-label="Start a new chat"
          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Chat</span>
        </button>
      </div>
    </header>
  );
}
