'use client';

/**
 * DocumentUpload Component
 *
 * Provides a responsive, accessible interface for uploading PDF documents
 * to partitioned knowledge scopes (NEC, Wattmonk, General).
 *
 * Requirements & Constraints:
 * 1. Accepts PDF uploads through multipart/form-data.
 * 2. Enforces configurable file size limits (default: 15 MB).
 * 3. Pre-validates extension (.pdf) and MIME type.
 * 4. Rejects malformed or oversized files with helpful user feedback.
 * 5. Prevents duplicate submissions while upload is in-flight.
 * 6. Explicitly displays reality-accurate indexing status (Pending Vector Indexing).
 * 7. Never trusts client filenames as disk paths (delegated to DocumentService).
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ContextType,
  DocumentResponsePayload,
  ApiResponse,
} from '@/lib/types';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  ShieldCheck,
  RefreshCw,
  Layers,
  ArrowRight,
} from 'lucide-react';

export interface DocumentUploadProps {
  /** If provided, renders as a modal overlay; if omitted/undefined, renders inline. */
  isOpen?: boolean;
  onClose?: () => void;
  onUploadSuccess?: (payload: DocumentResponsePayload) => void;
  defaultContext?: ContextType;
  maxSizeBytes?: number;
}

const DEFAULT_MAX_SIZE = 15 * 1024 * 1024; // 15 MB

const CONTEXT_OPTIONS: Array<{
  type: ContextType;
  label: string;
  badge: string;
  description: string;
}> = [
  {
    type: 'NEC',
    label: 'National Electrical Code (NEC)',
    badge: 'NEC 2023 / 2020',
    description: 'Electrical safety, grounding, Article 690 solar & Article 705 interconnection.',
  },
  {
    type: 'WATTMONK',
    label: 'Wattmonk Solar Engineering',
    badge: 'Solar & Storage',
    description: 'AHJ permit standards, engineering plan sets, utility interconnection specs.',
  },
  {
    type: 'GENERAL',
    label: 'General Technical / Building Codes',
    badge: 'General Standard',
    description: 'General safety, IBC/IRC building codes, and cross-discipline documentation.',
  },
];

export function DocumentUpload({
  isOpen,
  onClose,
  onUploadSuccess,
  defaultContext = 'NEC',
  maxSizeBytes = DEFAULT_MAX_SIZE,
}: DocumentUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [contextType, setContextType] = useState<ContextType>(defaultContext);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [successResult, setSuccessResult] = useState<DocumentResponsePayload | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync defaultContext if it changes
  useEffect(() => {
    if (defaultContext) {
      setContextType(defaultContext);
    }
  }, [defaultContext]);

  // Handle ESC key for modal dismissal
  useEffect(() => {
    if (isOpen === false) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isUploading && onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isUploading, onClose]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  /**
   * Client-side pre-validation for selected files.
   */
  const validateFile = useCallback(
    (file: File): string | null => {
      const filename = file.name.toLowerCase();
      if (!filename.endsWith('.pdf')) {
        return `Unsupported file extension. Only .pdf documents are accepted. Selected: ${file.name}`;
      }

      if (file.size <= 0) {
        return 'Selected file is empty (0 bytes). Please choose a valid PDF.';
      }

      if (file.size > maxSizeBytes) {
        const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1);
        const actualMb = (file.size / (1024 * 1024)).toFixed(2);
        return `File size (${actualMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`;
      }

      // Check MIME type if provided by browser
      if (
        file.type &&
        file.type !== 'application/pdf' &&
        file.type !== 'application/x-pdf' &&
        file.type !== 'application/octet-stream'
      ) {
        return `Invalid MIME type (${file.type}). Only PDF files are supported.`;
      }

      return null;
    },
    [maxSizeBytes]
  );

  const handleFileSelection = (file: File) => {
    setError(null);
    setSuccessResult(null);

    const validationError = validateFile(file);
    if (validationError) {
      setError({ message: validationError });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
    // Autofill title if empty
    if (!title) {
      const cleanName = file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
      setTitle(cleanName);
    }
  };

  // Drag & Drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploading) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isUploading) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const handleResetForm = () => {
    setSelectedFile(null);
    setTitle('');
    setAuthor('');
    setError(null);
    setSuccessResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Submits the upload using native multipart/form-data.
   * Prevents duplicate submissions while upload is in-flight.
   */
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate submissions while in-flight or if no file is selected
    if (isUploading || !selectedFile) {
      return;
    }

    const validationError = validateFile(selectedFile);
    if (validationError) {
      setError({ message: validationError });
      return;
    }

    setIsUploading(true);
    setError(null);
    setSuccessResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('contextType', contextType);

      if (title.trim()) {
        formData.append('title', title.trim());
      }
      if (author.trim()) {
        formData.append('author', author.trim());
      }

      const res = await fetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      const json = (await res.json()) as ApiResponse<DocumentResponsePayload>;

      if (!res.ok || !json.success) {
        const errorMsg =
          !json.success && json.error?.message
            ? json.error.message
            : `Upload failed with HTTP ${res.status}: ${res.statusText}`;
        const errorCode = !json.success ? json.error?.code : 'UPLOAD_FAILED';
        setError({ code: errorCode, message: errorMsg });
        return;
      }

      // Success
      setSuccessResult(json.data);
      if (onUploadSuccess) {
        onUploadSuccess(json.data);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Network error occurred while uploading document.';
      setError({ code: 'NETWORK_ERROR', message });
    } finally {
      setIsUploading(false);
    }
  };

  // If used as a modal and closed, return null
  if (isOpen === false) {
    return null;
  }

  const content = (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-xl w-full overflow-hidden flex flex-col">
      {/* Modal / Panel Header */}
      <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <UploadCloud className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100 leading-tight">
              Upload PDF Document
            </h2>
            <p className="text-[11px] text-slate-400">
              Ingest technical codebooks and standards into partitioned RAG scopes
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            aria-label="Close dialog"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Body Area */}
      <div className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
        {/* Success Presentation */}
        {successResult ? (
          <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/60 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-emerald-200">
                  PDF Uploaded & Validated Successfully
                </h3>
                <p className="text-[11px] text-emerald-300/80 leading-relaxed">
                  {successResult.statusMessage}
                </p>
              </div>
            </div>

            {/* Document Details Card */}
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                  <span className="text-xs font-medium text-slate-200 truncate max-w-[280px]">
                    {successResult.document.name}
                  </span>
                </div>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {successResult.document.metadata?.contextType || contextType}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
                <div>
                  <span className="text-slate-500">Document ID:</span>{' '}
                  <code className="text-slate-300 font-mono text-[10px]">
                    {successResult.document.id}
                  </code>
                </div>
                <div>
                  <span className="text-slate-500">File Size:</span>{' '}
                  <span className="text-slate-300">
                    {formatFileSize(successResult.document.size || 0)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Ingestion Status:</span>{' '}
                  <span
                    className={
                      successResult.isIndexed
                        ? 'text-emerald-400 font-medium'
                        : 'text-amber-400 font-medium'
                    }
                  >
                    {successResult.document.status}{' '}
                    {successResult.isIndexed
                      ? '(Ready & Indexed)'
                      : '(Pending Vector Indexing)'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Vector Index:</span>{' '}
                  <span
                    className={
                      successResult.isIndexed
                        ? 'text-emerald-400 font-medium'
                        : 'text-slate-400'
                    }
                  >
                    {successResult.isIndexed
                      ? `Indexed (${successResult.document.chunkCount || 0} chunks)`
                      : 'Not yet indexed'}
                  </span>
                </div>
              </div>
              {successResult.document.metadata?.isPersistent === false && (
                <div className="mt-2 p-2 rounded bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-300 flex items-center gap-1.5">
                  <span className="font-semibold">Notice:</span> Non-persistent in-memory vector storage in use. Vectors will be lost on server restart.
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleResetForm}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700/60 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
                <span>Upload Another Document</span>
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Upload Form */
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            {/* Error Presentation */}
            {error && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/70 flex items-start gap-2.5 animate-in fade-in duration-200"
              >
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-xs text-rose-200">
                  <p className="font-semibold text-rose-300">
                    {error.code ? `Error (${error.code})` : 'Upload Error'}
                  </p>
                  <p className="text-[11px] text-rose-300/90 leading-relaxed">
                    {error.message}
                  </p>
                </div>
              </div>
            )}

            {/* Context Scope Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                <span>Target Knowledge Scope</span>
                <span className="text-[10px] text-slate-500">Partitioned Storage</span>
              </label>
              <div className="grid grid-cols-1 gap-2">
                {CONTEXT_OPTIONS.map((opt) => {
                  const isSelected = contextType === opt.type;
                  return (
                    <button
                      key={opt.type}
                      type="button"
                      disabled={isUploading}
                      onClick={() => setContextType(opt.type)}
                      className={`text-left p-2.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                        isSelected
                          ? 'bg-indigo-950/40 border-indigo-500/60 ring-1 ring-indigo-500/40'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                      } ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-200">
                            {opt.label}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700/60">
                            {opt.badge}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-normal">
                          {opt.description}
                        </p>
                      </div>
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-600'
                            : 'border-slate-700 bg-slate-900'
                        }`}
                      >
                        {isSelected && (
                          <div className="w-1.5 h-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Drag and Drop Upload Zone */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">
                PDF Document File
              </label>

              <div
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => {
                  if (!isUploading && fileInputRef.current) {
                    fileInputRef.current.click();
                  }
                }}
                className={`relative border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-950/30 ring-2 ring-indigo-500/30'
                    : selectedFile
                    ? 'border-indigo-500/50 bg-slate-950/60'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-900/60'
                } ${isUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={isUploading}
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="pdf-upload-file-input"
                  aria-label="Upload PDF Document"
                />

                {selectedFile ? (
                  <div className="flex items-center justify-between gap-3 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-200 truncate">
                          {selectedFile.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {formatFileSize(selectedFile.size)} • PDF Ready
                        </p>
                      </div>
                    </div>
                    {!isUploading && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        aria-label="Remove selected file"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="w-10 h-10 mx-auto rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                      <UploadCloud className="w-5 h-5" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-slate-200">
                        Drag and drop your PDF here, or{' '}
                        <span className="text-indigo-400 underline underline-offset-2">
                          browse
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Standard PDF (.pdf) up to {(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Optional Metadata: Title & Author */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="doc-title-input"
                  className="text-[11px] font-medium text-slate-400"
                >
                  Document Title (Optional)
                </label>
                <input
                  id="doc-title-input"
                  type="text"
                  disabled={isUploading}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={selectedFile ? selectedFile.name.replace(/\.pdf$/i, '') : 'e.g. NEC 2023 Article 690'}
                  className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="doc-author-input"
                  className="text-[11px] font-medium text-slate-400"
                >
                  Author / Organization (Optional)
                </label>
                <input
                  id="doc-author-input"
                  type="text"
                  disabled={isUploading}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="e.g. NFPA, Wattmonk Engineering"
                  className="w-full text-xs px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Security Guarantee Banner */}
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center gap-2.5 text-[11px] text-slate-400">
              <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>
                Files are stored in private storage (isolated from web root) with magic byte verification.
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
              {onClose && (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              )}

              <button
                type="submit"
                disabled={!selectedFile || isUploading}
                aria-label="Upload and validate PDF"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-xs font-medium transition-all shadow-sm"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading & Validating...</span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload PDF</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  // If isOpen is explicitly passed as a boolean, wrap with modal backdrop
  if (typeof isOpen === 'boolean') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
      >
        {content}
      </div>
    );
  }

  // Otherwise render inline
  return content;
}
