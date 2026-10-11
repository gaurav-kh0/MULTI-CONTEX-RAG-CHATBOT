'use client';

import React, { useState } from 'react';
import { ChatMessage } from '@/lib/types';
import { CitationCard } from './CitationCard';
import { User, Bot, Copy, Check, Quote, Zap, Sun, BookOpen } from 'lucide-react';

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getScopeBadge = (scopeId: string) => {
    switch (scopeId) {
      case 'scope_nec':
        return { label: 'NEC', icon: Zap, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
      case 'scope_solar':
        return { label: 'Wattmonk/Solar', icon: Sun, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
      default:
        return { label: 'General', icon: BookOpen, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
    }
  };

  // Format message text with line breaks and bullet handling
  const renderFormattedContent = (content: string) => {
    const paragraphs = content.split('\n\n');
    return paragraphs.map((para, pIdx) => {
      const lines = para.split('\n');
      return (
        <div key={pIdx} className="space-y-1.5">
          {lines.map((line, lIdx) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
              return (
                <div key={lIdx} className="flex items-start gap-2 pl-2">
                  <span className="text-indigo-400 mt-1 text-xs">•</span>
                  <span>{trimmed.substring(2)}</span>
                </div>
              );
            }
            if (/^\d+\.\s/.test(trimmed)) {
              const numMatch = trimmed.match(/^(\d+\.)\s(.*)$/);
              if (numMatch) {
                return (
                  <div key={lIdx} className="flex items-start gap-2 pl-2">
                    <span className="text-indigo-400 font-mono text-xs">{numMatch[1]}</span>
                    <span>{numMatch[2]}</span>
                  </div>
                );
              }
            }
            return <p key={lIdx}>{line}</p>;
          })}
        </div>
      );
    });
  };

  return (
    <div
      className={`group flex gap-3 max-w-3xl transition-all ${
        isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
      }`}
    >
      {/* Avatar Icon */}
      <div
        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-slate-800 text-indigo-400 border border-slate-700'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble Content */}
      <div className={`space-y-2 max-w-2xl min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Scopes Header if present */}
        {message.contextScopeIds && message.contextScopeIds.length > 0 && (
          <div
            className={`flex flex-wrap items-center gap-1.5 ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            {message.contextScopeIds.map((scopeId) => {
              const badge = getScopeBadge(scopeId);
              const Icon = badge.icon;
              return (
                <span
                  key={scopeId}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${badge.color}`}
                >
                  <Icon className="w-2.5 h-2.5" />
                  <span>{badge.label}</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Message Card */}
        <div
          className={`p-4 rounded-2xl text-xs sm:text-sm leading-relaxed shadow-xs ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm selection:bg-indigo-700'
              : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-sm'
          }`}
        >
          {message.content ? (
            renderFormattedContent(message.content)
          ) : (
            <div className="flex items-center gap-2 text-slate-400 py-0.5" aria-label="Generating response">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" />
              </div>
              <span className="text-xs text-slate-400">Synthesizing response...</span>
            </div>
          )}
        </div>

        {/* Retrieved Citations Section */}
        {message.role === 'assistant' && message.citations && message.citations.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/90 space-y-2.5 mt-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
              <Quote className="w-3.5 h-3.5 text-indigo-400" />
              <span>Retrieved Reference Citations ({message.citations.length})</span>
            </div>
            <div className="space-y-2">
              {message.citations.map((citation, idx) => (
                <CitationCard key={idx} citation={citation} index={idx} />
              ))}
            </div>
          </div>
        )}

        {/* Footer Meta (Timestamp + Copy) */}
        <div
          className={`flex items-center gap-2 px-1 text-[10px] text-slate-500 ${
            isUser ? 'justify-end' : 'justify-start'
          }`}
        >
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span>•</span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy message text"
            className="hover:text-slate-300 transition-colors inline-flex items-center gap-1 opacity-70 group-hover:opacity-100"
            title="Copy message"
          >
            {copied ? (
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
        </div>
      </div>
    </div>
  );
}
