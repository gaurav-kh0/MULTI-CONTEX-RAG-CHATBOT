/**
 * Document Processor (RAG Ingestion Layer)
 *
 * Implements low-level validation, security checks, signature verification,
 * text extraction, and metadata extraction for uploaded PDF documents.
 *
 * Separation of Concerns:
 * - Decoupled from HTTP request handling and persistent storage.
 * - Operates directly on binary buffers and file metadata.
 * - Text extraction preserves per-page mapping and detects scanned/empty/encrypted PDFs.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { extractText as unpdfExtractText } from 'unpdf';

export const DEFAULT_MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB
export const DEFAULT_MIN_PDF_SIZE_BYTES = 1; // 1 Byte

export type DocumentProcessorErrorCode =
  | 'NO_FILE'
  | 'FILE_EMPTY'
  | 'PAYLOAD_TOO_LARGE'
  | 'INVALID_EXTENSION'
  | 'INVALID_MIME_TYPE'
  | 'INVALID_SIGNATURE'
  | 'CORRUPTED_PDF'
  | 'ENCRYPTED_PDF'
  | 'MALFORMED_PDF'
  | 'EMPTY_DOCUMENT'
  | 'UNSUPPORTED_SCANNED_PDF'
  | 'PROCESSING_ERROR';

export class DocumentProcessorError extends Error {
  readonly code: DocumentProcessorErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: DocumentProcessorErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DocumentProcessorError';
    this.code = code;
    this.details = details;
  }
}

export interface PdfValidationOptions {
  maxSizeBytes?: number;
  minSizeBytes?: number;
  allowedMimeTypes?: string[];
  strictEofCheck?: boolean;
}

export interface ProcessedPdfMetadata {
  originalFilename: string;
  sanitizedFilename: string;
  fileSizeBytes: number;
  sha256: string;
  pdfVersion: string;
  pageCount: number;
}

export interface ExtractedPage {
  pageNumber: number; // 1-indexed
  text: string;
  characterCount: number;
}

export interface ExtractedPdfDocument {
  pages: ExtractedPage[];
  totalPages: number;
  totalCharacters: number;
  pdfVersion?: string;
  hasText: boolean;
}

/**
 * Normalizes excessive whitespace in extracted text:
 * - Converts CRLF/CR to LF
 * - Replaces non-newline whitespace sequences with a single space
 * - Collapses 3+ newlines to 2 newlines (preserves paragraph breaks)
 * - Trims leading/trailing whitespace per line and overall
 */
export function normalizeWhitespace(text: string): string {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[^\S\r\n]+|[^\S\r\n]+$/gm, '')
    .trim();
}

export class DocumentProcessor {
  private maxSizeBytes: number;
  private minSizeBytes: number;
  private allowedMimeTypes: string[];

  constructor(options?: PdfValidationOptions) {
    this.maxSizeBytes =
      options?.maxSizeBytes ??
      (process.env.MAX_UPLOAD_SIZE_BYTES
        ? parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10)
        : DEFAULT_MAX_PDF_SIZE_BYTES);

    this.minSizeBytes = options?.minSizeBytes ?? DEFAULT_MIN_PDF_SIZE_BYTES;

    this.allowedMimeTypes = options?.allowedMimeTypes ?? [
      'application/pdf',
      'application/x-pdf',
      'application/octet-stream',
    ];
  }

  /**
   * Sanitizes a client-supplied filename to prevent path traversal,
   * hidden file exploits, or illegal filesystem characters.
   *
   * NEVER use the output directly as a physical filesystem path.
   */
  sanitizeFilename(rawFilename: string): string {
    if (!rawFilename || typeof rawFilename !== 'string') {
      return 'document.pdf';
    }

    // Strip directory traversal sequences (both Unix and Windows style)
    let base = path.basename(rawFilename);

    // Remove null bytes, control characters, and dangerous shell characters
    base = base.replace(/[\0\x00-\x1f\x7f-\x9f]/g, '');
    base = base.replace(/[<>:"/\\|?*]/g, '_');

    // Collapse multiple underscores or whitespace
    base = base.replace(/[\s_]+/g, '_').trim();

    // Ensure safe length
    const ext = path.extname(base).toLowerCase() || '.pdf';
    const nameWithoutExt = path.basename(base, ext).slice(0, 80);

    const clean = `${nameWithoutExt || 'document'}${ext.endsWith('.pdf') ? ext : '.pdf'}`;
    return clean;
  }

  /**
   * Validates file extension against allowed format (.pdf).
   */
  validateExtension(filename: string): void {
    if (!filename || typeof filename !== 'string') {
      throw new DocumentProcessorError(
        'INVALID_EXTENSION',
        'Filename is missing or invalid.'
      );
    }

    const ext = path.extname(filename).toLowerCase();
    if (ext !== '.pdf') {
      throw new DocumentProcessorError(
        'INVALID_EXTENSION',
        `Unsupported file extension '${ext || '(none)'}'. Only '.pdf' files are accepted.`
      );
    }
  }

  /**
   * Validates MIME type header from upload request.
   */
  validateMimeType(mimeType?: string): void {
    if (!mimeType) return; // If client didn't supply MIME type, signature check will verify

    const normalized = mimeType.trim().toLowerCase();
    if (!this.allowedMimeTypes.includes(normalized)) {
      throw new DocumentProcessorError(
        'INVALID_MIME_TYPE',
        `Invalid MIME type '${mimeType}'. Only PDF documents ('application/pdf') are supported.`
      );
    }
  }

  /**
   * Returns current maximum allowed file size in bytes.
   * Dynamically respects process.env.MAX_UPLOAD_SIZE_BYTES if set.
   */
  getMaxSizeBytes(): number {
    if (process.env.MAX_UPLOAD_SIZE_BYTES) {
      const parsed = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return this.maxSizeBytes;
  }

  /**
   * Enforces configurable file size limits.
   */
  validateSize(sizeBytes: number): void {
    if (sizeBytes < this.minSizeBytes) {
      throw new DocumentProcessorError(
        'FILE_EMPTY',
        'Uploaded file is empty (0 bytes).'
      );
    }

    const effectiveMax = this.getMaxSizeBytes();
    if (sizeBytes > effectiveMax) {
      const maxMb = (effectiveMax / (1024 * 1024)).toFixed(1);
      const actualMb = (sizeBytes / (1024 * 1024)).toFixed(2);
      throw new DocumentProcessorError(
        'PAYLOAD_TOO_LARGE',
        `File size (${actualMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`,
        { sizeBytes, maxSizeBytes: effectiveMax }
      );
    }
  }

  /**
   * Validates PDF magic bytes / header signature (%PDF-).
   *
   * Per ISO 32000-1 specification, a compliant PDF document begins
   * with the 5-byte sequence "%PDF-" (0x25, 0x50, 0x44, 0x46, 0x2D).
   */
  validateSignature(buffer: Buffer | Uint8Array): string {
    if (!buffer || buffer.length < 5) {
      throw new DocumentProcessorError(
        'INVALID_SIGNATURE',
        'File is too short to be a valid PDF document.'
      );
    }

    // Inspect the first 1024 bytes (allows for UTF-8 BOM or minor leading metadata)
    const headerSlice = Buffer.from(buffer.subarray(0, Math.min(buffer.length, 1024)));
    const headerString = headerSlice.toString('latin1');

    const magicIndex = headerString.indexOf('%PDF-');
    if (magicIndex === -1 || magicIndex > 32) {
      throw new DocumentProcessorError(
        'INVALID_SIGNATURE',
        'Invalid PDF signature. The file does not contain a valid %PDF- header.'
      );
    }

    // Extract PDF version from header (e.g. %PDF-1.4, %PDF-1.7, %PDF-2.0)
    const versionMatch = headerString.match(/%PDF-(\d+\.\d+)/);
    return versionMatch ? versionMatch[1] : '1.x';
  }

  /**
   * Verifies file integrity by checking for the standard end-of-file marker (%%EOF).
   */
  validateIntegrity(buffer: Buffer | Uint8Array): void {
    // Tail slice: examine the last 1024 bytes of the file
    const tailSlice = Buffer.from(
      buffer.subarray(Math.max(0, buffer.length - 1024))
    );
    const tailString = tailSlice.toString('latin1');

    if (!tailString.includes('%%EOF')) {
      throw new DocumentProcessorError(
        'CORRUPTED_PDF',
        'Corrupted or truncated PDF file: Missing end-of-file marker (%%EOF).'
      );
    }
  }

  /**
   * Scans PDF object dictionary to estimate page count.
   * Looks for occurrences of "/Type /Page" objects (avoiding "/Pages").
   */
  estimatePageCount(buffer: Buffer | Uint8Array): number {
    try {
      const content = Buffer.from(buffer).toString('latin1');
      const matches = content.match(/\/Type\s*\/Page\b/g);
      return matches && matches.length > 0 ? matches.length : 1;
    } catch {
      return 1;
    }
  }

  /**
   * Computes SHA-256 hash of buffer for verification and deduplication.
   */
  computeHash(buffer: Buffer | Uint8Array): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Complete validation and metadata extraction pipeline.
   */
  process(
    buffer: Buffer | Uint8Array,
    originalFilename: string,
    mimeType?: string
  ): ProcessedPdfMetadata {
    if (!buffer || buffer.length === 0) {
      throw new DocumentProcessorError(
        'FILE_EMPTY',
        'Uploaded file buffer is empty or missing.'
      );
    }

    // 1. Extension check
    this.validateExtension(originalFilename);

    // 2. MIME type check
    this.validateMimeType(mimeType);

    // 3. File size check
    this.validateSize(buffer.length);

    // 4. Magic bytes / PDF header signature check
    const pdfVersion = this.validateSignature(buffer);

    // 5. PDF EOF integrity check
    this.validateIntegrity(buffer);

    // 6. Extraction
    const sanitizedFilename = this.sanitizeFilename(originalFilename);
    const sha256 = this.computeHash(buffer);
    const pageCount = this.estimatePageCount(buffer);

    return {
      originalFilename,
      sanitizedFilename,
      fileSizeBytes: buffer.length,
      sha256,
      pdfVersion,
      pageCount,
    };
  }

  /**
   * Extracts text from a text-based PDF document, preserving page numbers.
   *
   * Features:
   * - Preserves 1-indexed page numbers.
   * - Normalizes excessive whitespace and newlines.
   * - Handles encrypted/password-protected PDFs with explicit error.
   * - Handles malformed PDF structures with explicit error.
   * - Detects scanned PDFs without extractable text and returns UNSUPPORTED_SCANNED_PDF.
   *
   * @throws DocumentProcessorError with appropriate code.
   */
  async extractText(buffer: Buffer | Uint8Array): Promise<ExtractedPdfDocument> {
    if (!buffer || buffer.length === 0) {
      throw new DocumentProcessorError(
        'FILE_EMPTY',
        'Cannot extract text from empty buffer.'
      );
    }

    // Convert Buffer/Uint8Array safely to a standard Uint8Array
    const uint8Array =
      buffer instanceof Uint8Array && !Buffer.isBuffer(buffer)
        ? buffer
        : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let parsedResult: { totalPages: number; text: string[] };
    try {
      parsedResult = await unpdfExtractText(uint8Array, { mergePages: false });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : '';
      const lowerMsg = errMsg.toLowerCase();

      // Check for password / encrypted PDF
      if (
        errName.includes('Password') ||
        lowerMsg.includes('password') ||
        lowerMsg.includes('encrypted') ||
        lowerMsg.includes('credentials')
      ) {
        throw new DocumentProcessorError(
          'ENCRYPTED_PDF',
          'PDF document is password-protected or encrypted. Encrypted PDFs cannot be processed.',
          { originalError: errMsg }
        );
      }

      // Check for corrupted or invalid PDF structure
      if (
        errName.includes('InvalidPDF') ||
        errName.includes('FormatError') ||
        lowerMsg.includes('invalid pdf') ||
        lowerMsg.includes('corrupt') ||
        lowerMsg.includes('damaged')
      ) {
        throw new DocumentProcessorError(
          'MALFORMED_PDF',
          `Malformed PDF structure: ${errMsg}`,
          { originalError: errMsg }
        );
      }

      throw new DocumentProcessorError(
        'PROCESSING_ERROR',
        `Failed to parse PDF document: ${errMsg}`,
        { originalError: errMsg }
      );
    }

    const totalPages =
      parsedResult.totalPages ||
      (Array.isArray(parsedResult.text) ? parsedResult.text.length : 0);

    if (totalPages === 0) {
      throw new DocumentProcessorError(
        'EMPTY_DOCUMENT',
        'PDF document contains no readable pages.'
      );
    }

    const rawPages = Array.isArray(parsedResult.text)
      ? parsedResult.text
      : typeof parsedResult.text === 'string'
      ? [parsedResult.text]
      : [];

    const pages: ExtractedPage[] = [];
    let totalCharacters = 0;

    for (let i = 0; i < totalPages; i++) {
      const rawText = rawPages[i] || '';
      const cleanText = normalizeWhitespace(rawText);
      pages.push({
        pageNumber: i + 1, // 1-indexed page number
        text: cleanText,
        characterCount: cleanText.length,
      });
      totalCharacters += cleanText.length;
    }

    // Scanned PDF detection:
    // If the PDF has pages, but the total extracted text across all pages is completely empty
    if (totalCharacters === 0) {
      throw new DocumentProcessorError(
        'UNSUPPORTED_SCANNED_PDF',
        'Scanned PDF detected with no extractable text. OCR is currently unavailable; only text-based PDFs are supported.',
        { totalPages, totalCharacters: 0 }
      );
    }

    return {
      pages,
      totalPages,
      totalCharacters,
      hasText: true,
    };
  }

  /**
   * Combined pipeline: validates the PDF and extracts text in a single operation.
   */
  async processAndExtract(
    buffer: Buffer | Uint8Array,
    originalFilename: string,
    mimeType?: string
  ): Promise<{ metadata: ProcessedPdfMetadata; extracted: ExtractedPdfDocument }> {
    const metadata = this.process(buffer, originalFilename, mimeType);
    const extracted = await this.extractText(buffer);
    return { metadata, extracted };
  }
}

export const documentProcessor = new DocumentProcessor();
