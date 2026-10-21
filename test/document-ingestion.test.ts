import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DocumentProcessor,
  DocumentProcessorError,
} from '../backend/rag/document-processor.ts';
import {
  TextChunker,
} from '../backend/rag/chunker.ts';
import {
  EmbeddingError,
  EMBEDDING_DIMENSIONS,
} from '../backend/rag/embeddings.ts';
import {
  InMemoryVectorStore,
} from '../backend/storage/index.ts';
import {
  DocumentService,
} from '../backend/services/document-service.ts';
import {
  DELETE,
} from '../app/api/documents/route.ts';
import type {
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// PDF Helper: Builds valid multi-page PDF buffer with extractable text streams
// ---------------------------------------------------------------------------
function createMultiPagePdfBuffer(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pageRefs = pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pageTexts.length} >>\nendobj\n`);
  pageTexts.forEach((txt, i) => {
    const pageObjNum = 3 + i * 2;
    const contentObjNum = 4 + i * 2;
    objects.push(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentObjNum} 0 R >>\nendobj\n`);
    const stream = `BT\n/F1 12 Tf\n50 700 Td\n(${txt}) Tj\nET\n`;
    objects.push(`${contentObjNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  });
  const body = '%PDF-1.7\n' + objects.join('');
  let xref = 'xref\n0 ' + (1 + objects.length) + '\n0000000000 65535 f \n';
  let offset = 9;
  for (const obj of objects) {
    xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    offset += obj.length;
  }
  const trailer = `trailer\n<< /Size ${1 + objects.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

// ---------------------------------------------------------------------------
// Mock Implementations for Deterministic Offline Testing
// ---------------------------------------------------------------------------
class MockEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'mock' as const;
  readonly name = 'Mock Embedding Provider';
  callCount = 0;
  shouldFail = false;
  failureError?: Error;

  async generateEmbedding(_text: string): Promise<number[]> {
    this.callCount++;
    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding failure');
    }
    return new Array(EMBEDDING_DIMENSIONS).fill(0.123);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    this.callCount++;
    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding failure');
    }
    return texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.123));
  }

  async embedDocumentChunks(chunks: Array<{ content: string } | string>): Promise<number[][]> {
    this.callCount++;
    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding failure');
    }
    return chunks.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.123));
  }
}

class MockVectorStore implements IVectorStore {
  isPersistent = true;
  providerName = 'pinecone';
  upsertedChunks: DocumentChunk[] = [];
  upsertedVectors: number[][] = [];
  deletedDocIds: string[] = [];
  upsertCallCount = 0;
  deleteCallCount = 0;
  shouldFailUpsert = false;
  upsertError?: Error;

  async upsertVectors(chunks: DocumentChunk[], vectors: number[][]): Promise<void> {
    this.upsertCallCount++;
    if (this.shouldFailUpsert) {
      throw this.upsertError || new Error('Simulated vector store upsert failure');
    }
    this.upsertedChunks.push(...chunks);
    this.upsertedVectors.push(...vectors);
  }

  async querySimilar(
    _vector: number[],
    _options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    return [];
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    this.deleteCallCount++;
    this.deletedDocIds.push(documentId);
    this.upsertedChunks = this.upsertedChunks.filter((c) => c.documentId !== documentId);
  }

  clear(): void {
    this.upsertedChunks = [];
    this.upsertedVectors = [];
    this.deletedDocIds = [];
    this.upsertCallCount = 0;
    this.deleteCallCount = 0;
    this.shouldFailUpsert = false;
    this.upsertError = undefined;
  }
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------
describe('Document Ingestion Workflow - Complete 6-Step Pipeline', () => {
  let tempDir: string;
  let mockEmbedding: MockEmbeddingProvider;
  let mockStorage: MockVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-ingest-test-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockEmbeddingProvider();
    mockStorage = new MockVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      processor: new DocumentProcessor(),
      chunker: new TextChunker({ chunkSize: 500, chunkOverlap: 100 }),
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('executes full 6-step ingestion workflow successfully and returns indexed status', async () => {
    const page1Text = 'NEC Article 690 provides safety requirements for solar photovoltaic PV systems. Grounding and bonding requirements must strictly comply with Section 690.41.';
    const page2Text = 'Section 690.12 requires rapid shutdown of PV systems on buildings. Rapid shutdown boundary is 1 foot from array.';
    const pdfBuffer = createMultiPagePdfBuffer([page1Text, page2Text]);

    const result = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'NEC_Article_690.pdf',
      contextType: 'NEC',
      title: 'NEC Article 690 Solar Standards',
      author: 'NFPA Panel',
    });

    // 1. Validate payload contracts
    assert.ok(result.document);
    assert.match(result.document.id, /^doc_\d+_[a-f0-9]+$/);
    assert.equal(result.document.name, 'NEC Article 690 Solar Standards');
    assert.equal(result.isIndexed, true);
    assert.equal(result.document.status, 'indexed');
    assert.ok(result.document.chunkCount && result.document.chunkCount >= 2);
    assert.ok(result.document.tokenCount && result.document.tokenCount > 0);
    assert.equal(result.document.metadata?.contextType, 'NEC');
    assert.equal(result.document.metadata?.author, 'NFPA Panel');
    assert.equal(result.document.metadata?.storageBackend, 'pinecone');
    assert.equal(result.document.metadata?.isPersistent, true);
    assert.ok(result.statusMessage.includes('indexed successfully'));

    // 2. Verify file was saved to private disk storage (NOT client filename)
    const expectedFilePath = path.join(tempDir, `${result.document.id}.pdf`);
    const fileStats = await fs.stat(expectedFilePath);
    assert.ok(fileStats.isFile());
    assert.equal(fileStats.size, pdfBuffer.length);

    // 3. Verify embedding provider was called
    assert.equal(mockEmbedding.callCount, 1);

    // 4. Verify vector store received upserted chunks and vectors
    assert.equal(mockStorage.upsertCallCount, 1);
    assert.equal(mockStorage.upsertedChunks.length, result.document.chunkCount);
    assert.equal(mockStorage.upsertedVectors.length, result.document.chunkCount);

    // 5. Verify deterministic chunk IDs and metadata
    const firstChunk = mockStorage.upsertedChunks[0];
    assert.equal(firstChunk.id, `${result.document.id}_chunk_0`);
    assert.equal(firstChunk.documentId, result.document.id);
    assert.equal(firstChunk.chunkIndex, 0);
    assert.equal(firstChunk.metadata.context, 'NEC');
    assert.equal(firstChunk.metadata.pageNumber, 1);

    // 6. Verify document retrieval via getDocument
    const fetched = await service.getDocument(result.document.id);
    assert.ok(fetched);
    assert.equal(fetched.id, result.document.id);
    assert.equal(fetched.status, 'indexed');
    assert.equal(fetched.chunkCount, result.document.chunkCount);
  });

  it('prevents duplicate indexing using SHA-256 content hash', async () => {
    const pdfBuffer = createMultiPagePdfBuffer([
      'Wattmonk engineering standard for AHJ plan set drafting and solar permit submittals.',
    ]);

    // First ingestion
    const firstResult = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'Wattmonk_Standard.pdf',
      contextType: 'WATTMONK',
      title: 'Wattmonk Plan Set Standard',
    });
    assert.equal(firstResult.isIndexed, true);
    assert.equal(mockEmbedding.callCount, 1);
    assert.equal(mockStorage.upsertCallCount, 1);

    // Second ingestion with IDENTICAL buffer into SAME context
    const secondResult = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'Wattmonk_Standard_Copy.pdf',
      contextType: 'WATTMONK',
      title: 'Wattmonk Plan Set Standard Re-upload',
    });

    // Must return existing document without re-embedding or re-upserting
    assert.equal(secondResult.document.id, firstResult.document.id);
    assert.equal(secondResult.isIndexed, true);
    assert.ok(secondResult.statusMessage.includes('deduplicated by SHA-256 hash'));
    // Embedding & vector store call counts must NOT have increased!
    assert.equal(mockEmbedding.callCount, 1);
    assert.equal(mockStorage.upsertCallCount, 1);
  });

  it('allows same document in DIFFERENT context partitions', async () => {
    const pdfBuffer = createMultiPagePdfBuffer([
      'General electrical and building safety standard applicable across multiple scopes.',
    ]);

    // Ingest into GENERAL
    const generalResult = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'Safety_Standard.pdf',
      contextType: 'GENERAL',
    });
    assert.equal(generalResult.isIndexed, true);
    assert.equal(mockEmbedding.callCount, 1);

    // Ingest identical buffer into NEC
    const necResult = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'Safety_Standard.pdf',
      contextType: 'NEC',
    });
    assert.equal(necResult.isIndexed, true);
    assert.notEqual(necResult.document.id, generalResult.document.id);
    assert.equal(mockEmbedding.callCount, 2);
  });
});

describe('Document Ingestion - Failure Handling at Each Stage', () => {
  let tempDir: string;
  let mockEmbedding: MockEmbeddingProvider;
  let mockStorage: MockVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-failure-test-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockEmbeddingProvider();
    mockStorage = new MockVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      processor: new DocumentProcessor(),
      chunker: new TextChunker(),
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('Stage 1 Failure: Rejects invalid PDF signature and does not create document', async () => {
    const invalidBuffer = Buffer.from('Plain text file content without any PDF magic header');

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: invalidBuffer,
          filename: 'invalid.pdf',
          contextType: 'GENERAL',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'INVALID_SIGNATURE');
        return true;
      }
    );

    // Verify no stray files created
    const files = await fs.readdir(tempDir);
    assert.equal(files.length, 0);
  });

  it('Stage 2 Failure: Handles extraction failure (corrupt structure) and marks document as error', async () => {
    // Has %PDF- and %%EOF to pass stage 1 validation, but malformed internal PDF structure
    const malformedPdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Malformed true >>\nendobj\n%%EOF\n');

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: malformedPdf,
          filename: 'corrupted_structure.pdf',
          contextType: 'GENERAL',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        return true;
      }
    );

    // Document was stored on disk, but recorded with status: 'error' (NOT indexed)
    const docs = await service.listDocuments('GENERAL');
    const erroredDoc = docs.find((d) => d.name.includes('corrupted_structure'));
    assert.ok(erroredDoc);
    assert.equal(erroredDoc.status, 'error');
    assert.ok(erroredDoc.metadata?.error);
    assert.ok(erroredDoc.metadata?.errorCode);
  });

  it('Stage 4 Failure: Handles embedding provider failure without claiming ready', async () => {
    const validPdf = createMultiPagePdfBuffer(['Valid content that will fail during embedding.']);

    // Configure embedding provider to throw rate limit error
    mockEmbedding.shouldFail = true;
    mockEmbedding.failureError = new EmbeddingError(
      'RATE_LIMIT_ERROR',
      'Quota exceeded for text-embedding-004'
    );

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: validPdf,
          filename: 'rate_limited.pdf',
          contextType: 'NEC',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        return true;
      }
    );

    // Verify vector store was NOT upserted
    assert.equal(mockStorage.upsertCallCount, 0);

    // Verify document is tracked as 'error', NEVER 'indexed'
    const docs = await service.listDocuments('NEC');
    const erroredDoc = docs.find((d) => d.name.includes('rate_limited'));
    assert.ok(erroredDoc);
    assert.equal(erroredDoc.status, 'error');
    assert.equal(erroredDoc.metadata?.errorCode, 'RATE_LIMIT_ERROR');
    assert.ok(String(erroredDoc.metadata?.error).includes('Quota exceeded'));
  });

  it('Stage 5 Failure: Handles vector store upsert failure and marks document as error', async () => {
    const validPdf = createMultiPagePdfBuffer(['Valid content that fails at vector storage upsert.']);

    // Configure vector store to throw failure
    mockStorage.shouldFailUpsert = true;
    mockStorage.upsertError = new Error('Pinecone connection timed out during upsert');

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: validPdf,
          filename: 'storage_timeout.pdf',
          contextType: 'WATTMONK',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Pinecone connection timed out'));
        return true;
      }
    );

    // Verify document status is 'error', NEVER 'indexed'
    const docs = await service.listDocuments('WATTMONK');
    const erroredDoc = docs.find((d) => d.name.includes('storage_timeout'));
    assert.ok(erroredDoc);
    assert.equal(erroredDoc.status, 'error');
    assert.ok(String(erroredDoc.metadata?.error).includes('Pinecone connection timed out'));
  });
});

describe('Document Deletion - Complete Cleanup', () => {
  let tempDir: string;
  let mockEmbedding: MockEmbeddingProvider;
  let mockStorage: MockVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-delete-test-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockEmbeddingProvider();
    mockStorage = new MockVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      processor: new DocumentProcessor(),
      chunker: new TextChunker(),
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('deletes vectors from store, unlinks disk file, and removes document record', async () => {
    const pdfBuffer = createMultiPagePdfBuffer(['Document content to be deleted shortly.']);

    const upload = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'to_delete.pdf',
      contextType: 'NEC',
    });

    const docId = upload.document.id;
    const filePath = path.join(tempDir, `${docId}.pdf`);

    // Verify file exists and vectors are present
    assert.ok(await fs.stat(filePath));
    assert.ok(mockStorage.upsertedChunks.some((c) => c.documentId === docId));

    // Execute deletion
    const deleted = await service.deleteDocument(docId);
    assert.equal(deleted, true);

    // Verify vector store deleteByDocumentId was called with docId
    assert.equal(mockStorage.deleteCallCount, 1);
    assert.ok(mockStorage.deletedDocIds.includes(docId));
    assert.equal(
      mockStorage.upsertedChunks.filter((c) => c.documentId === docId).length,
      0
    );

    // Verify file was unlinked from disk
    await assert.rejects(async () => {
      await fs.stat(filePath);
    });

    // Verify getDocument returns null
    const checkDoc = await service.getDocument(docId);
    assert.equal(checkDoc, null);
  });

  it('returns false when attempting to delete non-existent document ID', async () => {
    const deleted = await service.deleteDocument('doc_does_not_exist_9999');
    assert.equal(deleted, false);
    assert.equal(mockStorage.deleteCallCount, 0);
  });
});

describe('Storage Backend Labeling - Explicit In-Memory Fallback', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rag-fallback-test-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  it('labels in-memory vector store as non-persistent fallback and warns in status message', async () => {
    const inMemoryStore = new InMemoryVectorStore();
    const service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: new MockEmbeddingProvider(),
      vectorStore: inMemoryStore,
    });

    const pdfBuffer = createMultiPagePdfBuffer(['Testing in-memory non-persistent fallback vector store.']);

    const result = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'memory_fallback.pdf',
      contextType: 'GENERAL',
    });

    assert.equal(result.isIndexed, true);
    assert.equal(result.document.metadata?.storageBackend, 'in-memory-non-persistent');
    assert.equal(result.document.metadata?.isPersistent, false);
    assert.ok(result.statusMessage.includes('in-memory non-persistent fallback in use'));
    assert.ok(result.statusMessage.includes('lost on server restart'));

    // Verify vectors were actually saved to in-memory store
    assert.ok(inMemoryStore.getChunkCount() > 0);
  });
});

describe('HTTP Route Integration - /api/documents POST & DELETE', () => {
  it('handles DELETE request with ?id= query param successfully (HTTP 200)', async () => {
    // Seed doc_nec_690 is present in the service by default
    const req = new Request('http://localhost/api/documents?id=doc_nec_690', {
      method: 'DELETE',
    });

    const res = await DELETE(req);
    assert.equal(res.status, 200);

    const json = (await res.json()) as { success: boolean; data: { deleted: boolean; id: string } };
    assert.equal(json.success, true);
    assert.equal(json.data.deleted, true);
    assert.equal(json.data.id, 'doc_nec_690');
  });

  it('returns 404 when DELETE targets a non-existent document ID', async () => {
    const req = new Request('http://localhost/api/documents?id=non_existent_doc_id', {
      method: 'DELETE',
    });

    const res = await DELETE(req);
    assert.equal(res.status, 404);

    const json = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'NOT_FOUND');
  });

  it('returns 400 when DELETE is called without an ID', async () => {
    const req = new Request('http://localhost/api/documents', {
      method: 'DELETE',
    });

    const res = await DELETE(req);
    assert.equal(res.status, 400);

    const json = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  });
});
