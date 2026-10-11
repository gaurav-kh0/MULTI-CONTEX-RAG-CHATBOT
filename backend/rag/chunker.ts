/**
 * Text Chunker (RAG Ingestion Layer)
 *
 * Implements boundary-aware text chunking for Multi-Context RAG documents.
 *
 * Requirements & Guarantees:
 * 1. Target ~1000 character chunks with ~200 character overlap.
 * 2. Prioritizes natural text boundaries (paragraph -> line -> sentence -> clause -> word).
 * 3. Normalizes excessive whitespace and removes empty chunks.
 * 4. Preserves and attaches complete metadata:
 *    - documentId
 *    - filename
 *    - pageNumber (preserved from PDF parser)
 *    - context (NEC, WATTMONK, GENERAL)
 *    - chunkIndex (strictly sequential 0-indexed)
 *    - characterCount
 * 5. Completely decoupled from embeddings and vector databases.
 */

import type { ContextType, DocumentChunk } from '../../lib/types.ts';
import type { ExtractedPage } from './document-processor.ts';

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 200;
export const MIN_CHUNK_SIZE = 20;

export interface ChunkerOptions {
  /** Target chunk size in characters (default: 1000) */
  chunkSize?: number;
  /** Overlap between consecutive chunks in characters (default: 200) */
  chunkOverlap?: number;
  /** Minimum characters required to emit a chunk (default: 20) */
  minChunkSize?: number;
}

export interface ChunkMetadata {
  documentId: string;
  filename?: string;
  pageNumber?: number;
  context?: ContextType | string;
  chunkIndex: number;
  characterCount: number;
  startIndex?: number;
  endIndex?: number;
  [key: string]: unknown;
}

export interface DocumentChunkResult extends DocumentChunk {
  metadata: ChunkMetadata;
}

/**
 * Normalizes excessive whitespace in text while preserving paragraph structure.
 */
export function normalizeChunkWhitespace(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[^\S\r\n]+|[^\S\r\n]+$/gm, '')
    .trim();
}

export class TextChunker {
  private defaultChunkSize: number;
  private defaultChunkOverlap: number;
  private defaultMinChunkSize: number;

  constructor(options?: ChunkerOptions) {
    this.defaultChunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.defaultChunkOverlap = options?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    this.defaultMinChunkSize = options?.minChunkSize ?? MIN_CHUNK_SIZE;

    // Validate options: overlap must be strictly less than chunkSize
    if (this.defaultChunkOverlap >= this.defaultChunkSize) {
      this.defaultChunkOverlap = Math.floor(this.defaultChunkSize * 0.2);
    }
  }

  /**
   * Searches for the highest-priority natural boundary within a target window.
   *
   * Priority Order:
   * 1. Paragraph break: '\n\n'
   * 2. Line break: '\n'
   * 3. Sentence terminator: '.' / '?' / '!' followed by whitespace or quotes
   * 4. Clause punctuation: ';' / ':' followed by space
   * 5. Comma / phrase: ',' followed by space
   * 6. Word boundary: space ' '
   */
  private findBestBoundary(
    text: string,
    windowStart: number,
    windowEnd: number,
    idealCut: number
  ): number {
    const slice = text.substring(windowStart, windowEnd);
    if (!slice) return idealCut;

    // 1. Paragraph break (\n\n)
    const paraIndices: number[] = [];
    let pIdx = slice.indexOf('\n\n');
    while (pIdx !== -1) {
      paraIndices.push(windowStart + pIdx + 2); // cut after \n\n
      pIdx = slice.indexOf('\n\n', pIdx + 1);
    }
    if (paraIndices.length > 0) {
      return this.pickClosest(paraIndices, idealCut);
    }

    // 2. Single Line break (\n)
    const lineIndices: number[] = [];
    let lIdx = slice.indexOf('\n');
    while (lIdx !== -1) {
      lineIndices.push(windowStart + lIdx + 1); // cut after \n
      lIdx = slice.indexOf('\n', lIdx + 1);
    }
    if (lineIndices.length > 0) {
      return this.pickClosest(lineIndices, idealCut);
    }

    // 3. Sentence boundary (. ! ? followed by space, quote, or end)
    const sentenceRegex = /[.?!]["')\]]?(?=\s|$)/g;
    const sentenceIndices: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = sentenceRegex.exec(slice)) !== null) {
      sentenceIndices.push(windowStart + match.index + match[0].length);
    }
    if (sentenceIndices.length > 0) {
      return this.pickClosest(sentenceIndices, idealCut);
    }

    // 4. Clause punctuation (; or : followed by space)
    const clauseRegex = /[:;](?=\s)/g;
    const clauseIndices: number[] = [];
    while ((match = clauseRegex.exec(slice)) !== null) {
      clauseIndices.push(windowStart + match.index + 1);
    }
    if (clauseIndices.length > 0) {
      return this.pickClosest(clauseIndices, idealCut);
    }

    // 5. Comma boundary (, followed by space)
    const commaRegex = /,(?=\s)/g;
    const commaIndices: number[] = [];
    while ((match = commaRegex.exec(slice)) !== null) {
      commaIndices.push(windowStart + match.index + 1);
    }
    if (commaIndices.length > 0) {
      return this.pickClosest(commaIndices, idealCut);
    }

    // 6. Word boundary (space)
    const spaceIndices: number[] = [];
    let sIdx = slice.indexOf(' ');
    while (sIdx !== -1) {
      spaceIndices.push(windowStart + sIdx);
      sIdx = slice.indexOf(' ', sIdx + 1);
    }
    if (spaceIndices.length > 0) {
      return this.pickClosest(spaceIndices, idealCut);
    }

    // Fallback: hard cut at ideal index
    return idealCut;
  }

  /**
   * Helper to pick candidate index closest to the ideal cut.
   */
  private pickClosest(candidates: number[], target: number): number {
    let closest = candidates[0];
    let minDiff = Math.abs(candidates[0] - target);

    for (let i = 1; i < candidates.length; i++) {
      const diff = Math.abs(candidates[i] - target);
      if (diff < minDiff) {
        minDiff = diff;
        closest = candidates[i];
      }
    }
    return closest;
  }

  /**
   * Snaps next start index to a clean word or sentence start.
   */
  private alignNextStart(text: string, idealStart: number, currentStart: number): number {
    if (idealStart <= currentStart) {
      return currentStart + 1;
    }

    // Search small local window [-40, +40] around idealStart for a space or newline
    const localStart = Math.max(currentStart + 1, idealStart - 40);
    const localEnd = Math.min(text.length, idealStart + 40);
    const localSlice = text.substring(localStart, localEnd);

    // Look for space or newline
    const firstSpace = localSlice.search(/[\s]/);
    if (firstSpace !== -1) {
      const candidate = localStart + firstSpace + 1;
      // Skip consecutive whitespace
      let snapped = candidate;
      while (snapped < text.length && /\s/.test(text[snapped])) {
        snapped++;
      }
      if (snapped > currentStart && snapped < text.length) {
        return snapped;
      }
    }

    return idealStart;
  }

  /**
   * Splits raw text into boundary-aware chunks with overlap.
   * Supports both new object metadata and backwards-compatible (text, docId, metadata) signatures.
   */
  chunkText(
    rawText: string,
    metadataOrDocId:
      | string
      | {
          documentId: string;
          filename?: string;
          pageNumber?: number;
          context?: ContextType | string;
          [key: string]: unknown;
        },
    legacyMetadataOrOptions?: Record<string, unknown> | ChunkerOptions,
    options?: ChunkerOptions
  ): DocumentChunkResult[] {
    const text = normalizeChunkWhitespace(rawText);
    if (!text || text.length === 0) {
      return [];
    }

    let metadata: {
      documentId: string;
      filename?: string;
      pageNumber?: number;
      context?: ContextType | string;
      [key: string]: unknown;
    };
    let effectiveOptions: ChunkerOptions | undefined;

    if (typeof metadataOrDocId === 'string') {
      const docId = metadataOrDocId;
      const legacyMeta = (legacyMetadataOrOptions as Record<string, unknown>) || {};
      metadata = {
        documentId: docId,
        ...legacyMeta,
      };
      effectiveOptions = options;
    } else {
      metadata = metadataOrDocId;
      effectiveOptions = legacyMetadataOrOptions as ChunkerOptions;
    }

    const chunkSize = effectiveOptions?.chunkSize ?? this.defaultChunkSize;
    let chunkOverlap = effectiveOptions?.chunkOverlap ?? this.defaultChunkOverlap;
    const minChunkSize = effectiveOptions?.minChunkSize ?? this.defaultMinChunkSize;

    // Safety guard: overlap must be strictly less than chunkSize
    if (chunkOverlap >= chunkSize) {
      chunkOverlap = Math.floor(chunkSize * 0.2);
    }

    // Base case: if entire text fits in one chunk
    if (text.length <= chunkSize) {
      const chunk: DocumentChunkResult = {
        id: `${metadata.documentId}_chunk_0`,
        documentId: metadata.documentId,
        content: text,
        chunkIndex: 0,
        tokenCount: Math.ceil(text.length / 4),
        metadata: {
          ...metadata,
          chunkIndex: 0,
          characterCount: text.length,
          startIndex: 0,
          endIndex: text.length,
        },
      };
      return [chunk];
    }

    const chunks: DocumentChunkResult[] = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      // If remainder fits in a single chunk
      if (text.length - start <= chunkSize) {
        const remainingContent = text.substring(start).trim();
        if (remainingContent.length >= minChunkSize || chunks.length === 0) {
          chunks.push({
            id: `${metadata.documentId}_chunk_${chunkIndex}`,
            documentId: metadata.documentId,
            content: remainingContent,
            chunkIndex,
            tokenCount: Math.ceil(remainingContent.length / 4),
            metadata: {
              ...metadata,
              chunkIndex,
              characterCount: remainingContent.length,
              startIndex: start,
              endIndex: text.length,
            },
          });
        }
        break;
      }

      // Find optimal cut point near start + chunkSize
      const idealEnd = start + chunkSize;
      const searchWindowStart = Math.max(start + 1, idealEnd - 250);
      const searchWindowEnd = Math.min(text.length, idealEnd + 50);

      const cutEnd = this.findBestBoundary(
        text,
        searchWindowStart,
        searchWindowEnd,
        idealEnd
      );

      const chunkSlice = text.substring(start, cutEnd).trim();
      if (chunkSlice.length >= minChunkSize) {
        chunks.push({
          id: `${metadata.documentId}_chunk_${chunkIndex}`,
          documentId: metadata.documentId,
          content: chunkSlice,
          chunkIndex,
          tokenCount: Math.ceil(chunkSlice.length / 4),
          metadata: {
            ...metadata,
            chunkIndex,
            characterCount: chunkSlice.length,
            startIndex: start,
            endIndex: cutEnd,
          },
        });
        chunkIndex++;
      }

      // Next start position with overlap
      const idealNextStart = Math.max(start + 1, cutEnd - chunkOverlap);
      const nextStart = this.alignNextStart(text, idealNextStart, start);

      // Strict forward progress guarantee
      start = Math.max(start + 1, nextStart);
    }

    return chunks;
  }

  /**
   * Chunks an array of extracted PDF pages, preserving page numbers and
   * maintaining a continuous sequential chunkIndex.
   *
   * Skips completely empty pages to prevent generating empty chunks.
   */
  chunkDocumentPages(
    documentId: string,
    pages: ExtractedPage[],
    baseMetadata: {
      filename?: string;
      context?: ContextType | string;
      [key: string]: unknown;
    },
    options?: ChunkerOptions
  ): DocumentChunkResult[] {
    const allChunks: DocumentChunkResult[] = [];
    let globalChunkIndex = 0;

    for (const page of pages) {
      const pageText = normalizeChunkWhitespace(page.text);

      // Requirement: Remove empty chunks and empty pages
      if (!pageText || pageText.length === 0) {
        continue;
      }

      const pageChunks = this.chunkText(
        pageText,
        {
          documentId,
          filename: baseMetadata.filename,
          pageNumber: page.pageNumber, // Preserved 1-indexed page number
          context: baseMetadata.context,
          ...baseMetadata,
        },
        options
      );

      for (const chunk of pageChunks) {
        // Re-index sequentially across entire document
        const sequentialId = `${documentId}_chunk_${globalChunkIndex}`;
        allChunks.push({
          ...chunk,
          id: sequentialId,
          chunkIndex: globalChunkIndex,
          metadata: {
            ...chunk.metadata,
            chunkIndex: globalChunkIndex,
            pageNumber: page.pageNumber,
          },
        });
        globalChunkIndex++;
      }
    }

    return allChunks;
  }
}

export const textChunker = new TextChunker();
