'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { ProviderId, ProviderInfo } from '@/lib/types';
import { Cpu, ChevronDown, Check, Sparkles, KeyRound } from 'lucide-react';

interface ProviderModelSelectorProps {
  providers: ProviderInfo[];
  selectedProviderId: ProviderId;
  selectedModel: string;
  onSelectProvider: (providerId: ProviderId, model?: string) => void;
  onSelectModel: (model: string) => void;
  disabled?: boolean;
}

export function ProviderModelSelector({
  providers,
  selectedProviderId,
  selectedModel,
  onSelectProvider,
  onSelectModel,
  disabled = false,
}: ProviderModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click or ESC key
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const activeProvider = providers.find((p) => p.id === selectedProviderId) || {
    id: selectedProviderId,
    name: selectedProviderId.charAt(0).toUpperCase() + selectedProviderId.slice(1),
    isConfigured: true,
    defaultModel: selectedModel,
    models: [selectedModel],
  };

  const handleProviderChange = (provider: ProviderInfo) => {
    onSelectProvider(provider.id, provider.defaultModel || provider.models[0]);
  };

  const handleModelChange = (model: string) => {
    onSelectModel(model);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select AI provider and model"
        className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 text-slate-200 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        <span className="truncate max-w-[90px] sm:max-w-[130px] font-semibold text-slate-100">
          {activeProvider.name}
        </span>
        <span className="text-slate-500 hidden sm:inline">:</span>
        <span className="truncate max-w-[100px] sm:max-w-[140px] text-slate-300 font-mono text-[11px] hidden sm:inline">
          {selectedModel.replace('meta-llama/', '').replace('deepseek-ai/', '').replace('anthropic/', '').replace('openai/', '')}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover Menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Available AI Providers and Models"
          className="absolute right-0 mt-1.5 w-72 sm:w-80 rounded-xl bg-slate-900 border border-slate-700/90 shadow-2xl py-2 z-50 text-xs animate-in fade-in-50 zoom-in-95 duration-150 backdrop-blur-md"
        >
          <div className="px-3 py-1.5 border-b border-slate-800 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
            <span>Select AI Provider & Model</span>
            <Sparkles className="w-3 h-3 text-indigo-400" />
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60 p-1">
            {providers.map((provider) => {
              const isProviderActive = provider.id === selectedProviderId;

              return (
                <div key={provider.id} className="py-2 px-2 space-y-1.5">
                  {/* Provider Header */}
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleProviderChange(provider)}
                      className="flex items-center gap-2 text-left group"
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          provider.isConfigured ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                        title={provider.isConfigured ? 'Configured' : 'Missing API Key in .env'}
                      />
                      <span
                        className={`font-semibold ${
                          isProviderActive
                            ? 'text-indigo-400'
                            : 'text-slate-200 group-hover:text-white'
                        }`}
                      >
                        {provider.name}
                      </span>
                    </button>

                    <div className="flex items-center gap-1">
                      {!provider.isConfigured && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                          <KeyRound className="w-2.5 h-2.5" />
                          <span>No Key</span>
                        </span>
                      )}
                      {provider.isConfigured && (
                        <span className="text-[10px] text-emerald-400/90 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                          Active
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Models list under this provider */}
                  <div className="pl-4 space-y-0.5">
                    {provider.models.map((model) => {
                      const isModelSelected =
                        isProviderActive && selectedModel === model;

                      return (
                        <button
                          key={model}
                          type="button"
                          onClick={() => {
                            if (!isProviderActive) {
                              onSelectProvider(provider.id, model);
                            } else {
                              handleModelChange(model);
                            }
                            setIsOpen(false);
                          }}
                          className={`w-full flex items-center justify-between px-2 py-1 rounded-md text-left transition-colors ${
                            isModelSelected
                              ? 'bg-indigo-600/20 text-indigo-300 font-medium border border-indigo-500/30'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="font-mono text-[11px] truncate">
                            {model}
                          </span>
                          {isModelSelected && (
                            <Check className="w-3 h-3 text-indigo-400 shrink-0 ml-1.5" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-1.5 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
            <span>Powered by Multi-Context RAG</span>
            <span className="text-slate-400">Strictly no keys exposed</span>
          </div>
        </div>
      )}
    </div>
  );
}
