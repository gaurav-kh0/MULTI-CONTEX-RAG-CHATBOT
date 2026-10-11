/**
 * Document Service (Server-Only Orchestration Layer)
 *
 * Implements the end-to-end document-ingestion and lifecycle management workflow:
 * 1. Validate the upload (MIME, size, extension, %PDF- magic bytes, %%EOF, SHA-256).
 * 2. Extract PDF text per-page (preserves 1-indexed page numbers, handles scanned/encrypted).
 * 3. Create boundary-aware chunks (~1000 chars, ~200 overlap) and attach metadata.
 * 4. Generate embeddings (768-dim Google text-embedding-004 vectors via batching).
 * 5. Upsert vectors into Pinecone (or active vector store) with deterministic IDs.
 * 6. Return document ID, filename, chunk count, and processing status.
 *
 * Security & Separation of Concerns:
 * - Content is stored strictly outside the public web directory in private storage.
 * - Client-supplied filenames are NEVER trusted as storage paths.
 * - Files on disk are named strictly via generated unique document IDs.
 * - Ingestion status accurately reflects reality: documents are reported as 'indexed'
 *   ONLY when embedding generation and vector upsert succeed.
 * - Deletion purges vectors via documentId metadata filter and cleans disk storage.
 * - Duplicate indexing is prevented via SHA-256 content hashing.
 * - In-memory fallback is explicitly labeled as non-persistent.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ContextDocument,
  ContextType,
  DocumentResponsePayload,
  DocumentUploadRequest,
  IEmbeddingProvider,
  IVectorStore,
} from '../../lib/types.ts';
import {
  DocumentProcessor,
  documentProcessor,
  DocumentProcessorError,
  type ProcessedPdfMetadata,
} from '../rag/document-processor.ts';
import {
  TextChunker,
  textChunker,
  type DocumentChunkResult,
} from '../rag/chunker.ts';
import {
  defaultEmbeddingProvider,
  GeminiEmbeddingProvider,
  EmbeddingError,
} from '../rag/embeddings.ts';
import {
  getActiveVectorStore,
  InMemoryVectorStore,
} from '../storage/index.ts';

export interface DocumentServiceConfig {
  storageDir?: string;
  processor?: DocumentProcessor;
  chunker?: TextChunker;
  embeddingProvider?: IEmbeddingProvider;
  vectorStore?: IVectorStore;
}

export interface UploadPdfDocumentParams {
  buffer: Buffer | Uint8Array;
  filename: string;
  mimeType?: string;
  contextType: ContextType;
  title?: string;
  author?: string;
  sourceUrl?: string;
  /**
   * If false, only validates and stores file on disk without triggering text extraction,
   * chunking, embedding, and vector upsert. Default: true (full ingestion workflow).
   */
  autoIndex?: boolean;
}

export class DocumentService {
  private documents: Map<string, ContextDocument> = new Map();
  private storageDir: string;
  private processor: DocumentProcessor;
  private chunker: TextChunker;
  private embeddingProvider: IEmbeddingProvider;
  private vectorStore: IVectorStore;

  constructor(config?: DocumentServiceConfig) {
    this.storageDir =
      config?.storageDir ??
      process.env.DOCUMENT_STORAGE_DIR ??
      path.join(process.cwd(), 'storage', 'uploads');

    this.processor = config?.processor ?? documentProcessor;
    this.chunker = config?.chunker ?? textChunker;
    this.embeddingProvider = config?.embeddingProvider ?? defaultEmbeddingProvider;
    this.vectorStore = config?.vectorStore ?? getActiveVectorStore();

    this.seedDefaultDocuments();
  }

  private seedDefaultDocuments(): void {
    const seedDocs: ContextDocument[] = [
      {
        id: 'doc_nec_690',
        name: 'NEC 2023 Article 690 - Solar Photovoltaic Systems.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 1420000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        metadata: {
          contextType: 'NEC',
          title: 'NEC 2023 Article 690 - Solar Photovoltaic Systems',
          author: 'NFPA',
        },
      },
      {
        id: 'doc_nec_705',
        name: 'NEC 2023 Article 705 - Interconnected Electric Power Production Sources.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 980000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        metadata: {
          contextType: 'NEC',
          title: 'NEC 2023 Article 705 - Interconnected Power Sources',
          author: 'NFPA',
        },
      },
      {
        id: 'doc_wm_plansets',
        name: 'Wattmonk AHJ Permit Plan Set Standards v4.2.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 2150000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 43200000).toISOString(),
        updatedAt: new Date(Date.now() - 43200000).toISOString(),
        metadata: {
          contextType: 'WATTMONK',
          title: 'Wattmonk AHJ Permit Plan Set Standards',
          author: 'Wattmonk Engineering Team',
        },
      },
      {
        id: 'doc_general_guidelines',
        name: 'General Electrical Safety & Building Code Guidelines.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 512000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 21600000).toISOString(),
        updatedAt: new Date(Date.now() - 21600000).toISOString(),
        metadata: {
          contextType: 'GENERAL',
          title: 'General Electrical Safety & Building Code Guidelines',
        },
      },
    ];

    for (const doc of seedDocs) {
      this.documents.set(doc.id, doc);
    }
  }

  /**
   * Returns directory configured for storing uploaded documents.
   */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * Returns active vector store instance.
   */
  getVectorStore(): IVectorStore {
    return this.vectorStore;
  }

  /**
   * Returns active embedding provider instance.
   */
  getEmbeddingProvider(): IEmbeddingProvider {
    return this.embeddingProvider;
  }

  /**
   * Returns active text chunker instance.
   */
  getChunker(): TextChunker {
    return this.chunker;
  }

  /**
   * Returns active document processor instance.
   */
  getProcessor(): DocumentProcessor {
    return this.processor;
  }

  /**
   * Clears internal state and resets to seed defaults (primarily for test environments).
   */
  clear(): void {
    this.documents.clear();
    this.seedDefaultDocuments();
  }

  /**
   * Complete document-ingestion sequence:
   * 1. Validate the upload (extension, MIME, size, %PDF- magic bytes, %%EOF, SHA-256).
   * 2. Deduplicate: if matching SHA-256 already indexed in this context, return immediately.
   * 3. Store PDF securely in private storage (never in public directory).
   * 4. Extract PDF text per page (preserves 1-indexed page numbers).
   * 5. Create boundary-aware chunks (~1000 chars, ~200 overlap) and attach metadata.
   * 6. Generate 768-dim embeddings via provider.
   * 7. Upsert vectors into Pinecone (or active vector store) with deterministic IDs.
   * 8. Return document ID, filename, chunk count, and processing status.
   *
   * Failure Handling:
   * - Never reports document as indexed if extraction, embedding, or upsert fails.
   * - Records document with status 'error' and preserves error details on failure.
   */
  async uploadDocument(
    params: UploadPdfDocumentParams
  ): Promise<DocumentResponsePayload> {
    // -------------------------------------------------------------------------
    // Step 1: Validate the upload
    // -------------------------------------------------------------------------
    const processedMeta: ProcessedPdfMetadata = this.processor.process(
      params.buffer,
      params.filename,
      params.mimeType
    );

    // -------------------------------------------------------------------------
    // Step 2: Prevent duplicate indexing via SHA-256 hash
    // -------------------------------------------------------------------------
    const existingDoc = Array.from(this.documents.values()).find(
      (doc) =>
        doc.metadata?.sha256 === processedMeta.sha256 &&
        doc.metadata?.contextType === params.contextType &&
        doc.status === 'indexed'
    );

    if (existingDoc) {
      return {
        document: existingDoc,
        isIndexed: true,
        statusMessage: `Document '${processedMeta.originalFilename}' is already indexed in context ${params.contextType} (deduplicated by SHA-256 hash).`,
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Secure private file storage
    // -------------------------------------------------------------------------
    const uniqueSuffix = crypto.randomBytes(4).toString('hex');
    const documentId = `doc_${Date.now()}_${uniqueSuffix}`;

    const diskFilename = `${documentId}.pdf`;
    const targetStoragePath = path.resolve(this.storageDir, diskFilename);

    // Security guard: Ensure target path strictly resides within storageDir
    const resolvedRoot = path.resolve(this.storageDir);
    if (!targetStoragePath.startsWith(resolvedRoot)) {
      throw new Error('Security Error: Path traversal attempt detected.');
    }

    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.writeFile(targetStoragePath, Buffer.from(params.buffer));

    const displayName =
      params.title?.trim() || processedMeta.sanitizedFilename;

    const newDoc: ContextDocument = {
      id: documentId,
      name: displayName,
      sourceType: 'file',
      status: 'uploaded',
      size: processedMeta.fileSizeBytes,
      mimeType: 'application/pdf',
      tokenCount: 0,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        contextType: params.contextType,
        title: displayName,
        author: params.author?.trim(),
        sourceUrl: params.sourceUrl?.trim(),
        originalFilename: processedMeta.originalFilename,
        sanitizedFilename: processedMeta.sanitizedFilename,
        storagePath: targetStoragePath,
        sha256: processedMeta.sha256,
        pageCount: processedMeta.pageCount,
        pdfVersion: processedMeta.pdfVersion,
      },
    };

    this.documents.set(documentId, newDoc);

    // If caller explicitly requested upload only (no indexing)
    if (params.autoIndex === false) {
      return {
        document: newDoc,
        isIndexed: false,
        statusMessage:
          'PDF document uploaded and validated successfully. ' +
          'Stored in private archive; pending text extraction and vector indexing.',
      };
    }

    // -------------------------------------------------------------------------
    // Steps 4-7: Text Extraction, Chunking, Embeddings, Vector Upsert
    // -------------------------------------------------------------------------
    try {
      newDoc.status = 'processing';

      // 4. Extract PDF text
      const extracted = await this.processor.extractText(params.buffer);
      if (!extracted.hasText || extracted.pages.length === 0) {
        throw new DocumentProcessorError(
          'EMPTY_DOCUMENT',
          'No extractable text found in PDF document.'
        );
      }

      // 5. Create chunks and metadata
      const chunks: DocumentChunkResult[] = this.chunker.chunkDocumentPages(
        documentId,
        extracted.pages,
        {
          filename: processedMeta.sanitizedFilename,
          originalFilename: processedMeta.originalFilename,
          context: params.contextType,
          title: displayName,
          author: params.author?.trim(),
        }
      );

      if (chunks.length === 0) {
        throw new DocumentProcessorError(
          'EMPTY_DOCUMENT',
          'Text chunker produced 0 chunks from extracted pages.'
        );
      }

      // 6. Generate embeddings
      let vectors: number[][];
      if (
        'embedDocumentChunks' in this.embeddingProvider &&
        typeof (this.embeddingProvider as unknown as { embedDocumentChunks: unknown }).embedDocumentChunks === 'function'
      ) {
        vectors = await (this.embeddingProvider as GeminiEmbeddingProvider).embedDocumentChunks(chunks);
      } else {
        const texts = chunks.map((c) => c.content);
        vectors = await this.embeddingProvider.generateBatchEmbeddings(texts);
      }

      if (!vectors || vectors.length !== chunks.length) {
        throw new EmbeddingError(
          'INVALID_OUTPUT',
          `Embedding provider returned ${vectors?.length ?? 0} vectors for ${chunks.length} chunks.`
        );
      }

      // 7. Upsert vectors into vector store
      await this.vectorStore.upsertVectors(chunks, vectors);

      // 8. Finalize document record
      const totalTokens = chunks.reduce(
        (sum, c) => sum + (c.tokenCount ?? Math.ceil(c.content.length / 4)),
        0
      );

      const isInMemory =
        this.vectorStore instanceof InMemoryVectorStore ||
        (this.vectorStore as { isPersistent?: boolean }).isPersistent === false ||
        process.env.VECTOR_STORE_PROVIDER === 'memory';

      const storageBackend = isInMemory ? 'in-memory-non-persistent' : 'pinecone';
      const isPersistent = !isInMemory;

      newDoc.status = 'indexed';
      newDoc.chunkCount = chunks.length;
      newDoc.tokenCount = totalTokens;
      newDoc.updatedAt = new Date().toISOString();
      newDoc.metadata = {
        ...newDoc.metadata,
        storageBackend,
        isPersistent,
        indexedAt: new Date().toISOString(),
      };

      const statusMessage = isInMemory
        ? `Document '${displayName}' indexed successfully with ${chunks.length} chunks. (Warning: in-memory non-persistent fallback in use; vectors will be lost on server restart)`
        : `Document '${displayName}' indexed successfully with ${chunks.length} chunks into Pinecone vector index.`;

      return {
        document: newDoc,
        isIndexed: true,
        statusMessage,
      };
    } catch (err: unknown) {
      newDoc.status = 'error';
      newDoc.updatedAt = new Date().toISOString();
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorCode = (err as { code?: string })?.code || 'INGESTION_ERROR';
      newDoc.metadata = {
        ...newDoc.metadata,
        error: errorMessage,
        errorCode,
      };
      throw err;
    }
  }

  /**
   * Lists registered documents, optionally filtered by contextType.
   */
  async listDocuments(contextType?: ContextType): Promise<ContextDocument[]> {
    const all = Array.from(this.documents.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (!contextType) return all;
    return all.filter((doc) => doc.metadata?.contextType === contextType);
  }

  /**
   * Retrieves single document metadata by ID.
   */
  async getDocument(id: string): Promise<ContextDocument | null> {
    return this.documents.get(id) || null;
  }

  /**
   * Returns physical storage path on disk for document if available.
   */
  getDocumentFilePath(id: string): string | null {
    const doc = this.documents.get(id);
    if (!doc || !doc.metadata?.storagePath) return null;
    return String(doc.metadata.storagePath);
  }

  /**
   * Deletes document:
   * 1. Deletes associated vectors from vector store via document ID filter.
   * 2. Removes physical file from private storage disk.
   * 3. Removes document record from registered document index.
   */
  async deleteDocument(id: string): Promise<boolean> {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // 1. Delete associated vectors from vector store
    try {
      await this.vectorStore.deleteByDocumentId(id);
    } catch (err: unknown) {
      throw err;
    }

    // 2. Remove physical file from private storage if present
    if (doc.metadata?.storagePath && typeof doc.metadata.storagePath === 'string') {
      try {
        await fs.unlink(doc.metadata.storagePath);
      } catch {
        // Ignored if file was already removed or never written
      }
    }

    // 3. Remove document record from in-memory map
    return this.documents.delete(id);
  }

  /**
   * Backwards-compatible document metadata registration (for JSON requests).
   */
  async registerDocument(
    request: DocumentUploadRequest
  ): Promise<DocumentResponsePayload> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newDoc: ContextDocument = {
      id: docId,
      name: request.title,
      sourceType: request.content ? 'text' : 'file',
      status: 'idle',
      tokenCount: 0,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        contextType: request.contextType,
        title: request.title,
        author: request.author,
        sourceUrl: request.sourceUrl,
      },
    };

    this.documents.set(docId, newDoc);

    return {
      document: newDoc,
      isIndexed: false,
      statusMessage:
        'Document metadata registered successfully. ' +
        'PDF extraction, chunking, and vector embedding pipelines are not yet implemented in this phase.',
    };
  }
}

export const documentService = new DocumentService();
