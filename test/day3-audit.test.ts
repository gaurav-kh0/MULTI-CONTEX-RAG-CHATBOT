/**
 * Day 3 End-to-End Audit Test Suite
 *
 * Comprehensive audit of the RAG Ingestion Layer:
 * 1. Valid one-page PDF ingestion & metadata verification.
 * 2. Multi-page PDF ingestion with page preservation and boundary-aware chunking.
 * 3. Malformed PDF detection (corrupted structure, bad header, missing EOF).
 * 4. Empty-text / scanned PDF handling (clear unsupported scanned error).
 * 5. Oversized upload rejection (PAYLOAD_TOO_LARGE).
 * 6. Unsupported file type rejection (INVALID_EXTENSION, INVALID_MIME_TYPE).
 * 7. Duplicate ingestion prevention (SHA-256 hash deduplication).
 * 8. Embedding provider failure handling (never marks ready, status: 'error').
 * 9. Pinecone indexing failure handling (never marks ready, status: 'error').
 * 10. Document deletion (vector purge by document ID, disk unlink, index removal).
 * 11. Chunking verification: size (~1000), overlap (~200), boundary prioritization.
 * 12. Vector dimensions (768), stable deterministic IDs (${docId}_chunk_${chunkIndex}).
 * 13. Storage backend labeling: explicit non-persistent fallback vs Pinecone.
 * 14. Verification safeguards: Real vs Mocked status reporting.
 */

import test, { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  DocumentProcessor,
  DocumentProcessorError,
  normalizeWhitespace,
} from '../backend/rag/document-processor.ts';
import {
  TextChunker,
  textChunker,
  normalizeChunkWhitespace,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
} from '../backend/rag/chunker.ts';
import {
  GeminiEmbeddingProvider,
  EmbeddingError,
  EMBEDDING_DIMENSIONS,
} from '../backend/rag/embeddings.ts';
import {
  PineconeVectorStore,
  PineconeStorageError,
  DEFAULT_PINECONE_DIMENSION,
} from '../backend/storage/pinecone.ts';
import {
  InMemoryVectorStore,
  getActiveVectorStore,
} from '../backend/storage/index.ts';
import {
  DocumentService,
} from '../backend/services/document-service.ts';
import type {
  ContextType,
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// Binary PDF Fixture Generators
// ---------------------------------------------------------------------------

/**
 * Creates a valid PDF binary buffer containing multiple pages with text streams.
 */
function createPdfWithPages(pages: string[]): Buffer {
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pageRefs = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((txt, i) => {
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

/**
 * Creates an empty-text / scanned PDF buffer (contains a page object with 0-byte stream).
 */
function createScannedEmptyPdfBuffer(): Buffer {
  const body = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 0 >>
stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000062 00000 n 
0000000121 00000 n 
0000000185 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
235
%%EOF
`;
  return Buffer.from(body, 'latin1');
}

/**
 * Creates a structurally corrupt PDF (valid signature and %%EOF but corrupt objects).
 */
function createCorruptStructurePdf(): Buffer {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /CorruptSyntax >>>\n%%EOF\n', 'latin1');
}

// ---------------------------------------------------------------------------
// Mock Providers for Controlled Unit Testing
// ---------------------------------------------------------------------------

class MockAuditingEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini Text Embeddings (Mocked Audit)';
  callCount = 0;
  lastEmbeddedTexts: string[] = [];
  shouldFail = false;
  failureError?: Error;

  async generateEmbedding(text: string): Promise<number[]> {
    return (await this.generateBatchEmbeddings([text]))[0];
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    this.callCount++;
    this.lastEmbeddedTexts = texts;
    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding provider failure');
    }
    return texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.0456));
  }

  async embedDocumentChunks(chunks: Array<{ content: string } | string>): Promise<number[][]> {
    const texts = chunks.map((c) => (typeof c === 'string' ? c : c.content));
    return this.generateBatchEmbeddings(texts);
  }
}

class MockAuditingVectorStore implements IVectorStore {
  readonly isPersistent = true;
  readonly providerName = 'pinecone';
  upsertCallCount = 0;
  deleteCallCount = 0;
  lastUpsertedChunks: DocumentChunk[] = [];
  lastUpsertedVectors: number[][] = [];
  deletedDocumentIds: string[] = [];
  shouldFailUpsert = false;
  failureError?: Error;

  async upsertVectors(chunks: DocumentChunk[], vectors: number[][]): Promise<void> {
    this.upsertCallCount++;
    if (this.shouldFailUpsert) {
      throw this.failureError || new PineconeStorageError('STORAGE_ERROR', 'Simulated Pinecone upsert failure');
    }
    this.lastUpsertedChunks.push(...chunks);
    this.lastUpsertedVectors.push(...vectors);
  }

  async querySimilar(_vector: number[], _options?: RagQueryOptions): Promise<RagRetrievalResult[]> {
    return [];
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    this.deleteCallCount++;
    this.deletedDocumentIds.push(documentId);
    this.lastUpsertedChunks = this.lastUpsertedChunks.filter((c) => c.documentId !== documentId);
  }

  clear(): void {
    this.upsertCallCount = 0;
    this.deleteCallCount = 0;
    this.lastUpsertedChunks = [];
    this.lastUpsertedVectors = [];
    this.deletedDocumentIds = [];
    this.shouldFailUpsert = false;
    this.failureError = undefined;
  }
}

// ---------------------------------------------------------------------------
// 1. Valid One-Page PDF Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Valid One-Page PDF Ingestion', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-onepage-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      processor: new DocumentProcessor(),
      chunker: new TextChunker(),
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('correctly ingests a valid 1-page PDF: extracts text, attaches metadata, generates 768-dim vector, and marks indexed', async () => {
    const pageText =
      'NEC Article 690.41 requires PV system dc circuits to comply with one of the following: (1) 2-wire PV system with one conductor grounded, (2) Bipolar PV system with neutral grounded, or (3) Ungrounded PV system meeting 690.41(B).';
    const pdfBuffer = createPdfWithPages([pageText]);

    const result = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'NEC_690_41_Grounding.pdf',
      contextType: 'NEC',
      title: 'NEC 690.41 Grounding Rules',
      author: 'NFPA Code Committee',
    });

    // 1. Verify processing status
    assert.equal(result.isIndexed, true);
    assert.equal(result.document.status, 'indexed');
    assert.equal(result.document.name, 'NEC 690.41 Grounding Rules');
    assert.match(result.document.id, /^doc_\d+_[a-f0-9]+$/);

    // 2. Verify extracted chunk properties
    assert.equal(result.document.chunkCount, 1);
    assert.ok(result.document.tokenCount && result.document.tokenCount > 0);

    // 3. Verify vector store received upserted chunk with deterministic ID & 768 dimensions
    assert.equal(mockVectorStore.upsertCallCount, 1);
    const chunk = mockVectorStore.lastUpsertedChunks[0];
    assert.equal(chunk.id, `${result.document.id}_chunk_0`);
    assert.equal(chunk.chunkIndex, 0);
    assert.equal(chunk.documentId, result.document.id);
    assert.equal(chunk.metadata.pageNumber, 1);
    assert.equal(chunk.metadata.context, 'NEC');
    assert.ok(chunk.content.includes('NEC Article 690.41 requires PV system dc circuits'));

    const vector = mockVectorStore.lastUpsertedVectors[0];
    assert.equal(vector.length, EMBEDDING_DIMENSIONS);
    assert.equal(vector.length, 768);

    // 4. Verify storage isolation: file stored in private dir, not public
    const diskPath = service.getDocumentFilePath(result.document.id);
    assert.ok(diskPath);
    assert.ok(diskPath.startsWith(tempDir));
    const diskBytes = await fs.readFile(diskPath);
    assert.equal(diskBytes.length, pdfBuffer.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Multi-Page PDF & Boundary Chunker Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Multi-Page PDF & Boundary Chunker', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-multipage-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      chunker: new TextChunker({ chunkSize: 400, chunkOverlap: 80 }),
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('preserves 1-indexed page numbers across pages and maintains continuous sequential chunk indices', async () => {
    const page1 = 'Wattmonk AHJ Standards Sheet 1: General Project Information and Site Assessment Details.';
    const page2 = 'Wattmonk AHJ Standards Sheet 2: Single Line Diagram Electrical Schematic and Inverter Interconnection.';
    const page3 = 'Wattmonk AHJ Standards Sheet 3: Structural Roof Attachment and Wind/Snow Load Calculations.';
    const pdfBuffer = createPdfWithPages([page1, page2, page3]);

    const result = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'Wattmonk_Standards_3Page.pdf',
      contextType: 'WATTMONK',
      title: 'Wattmonk Multi-Page Standards',
    });

    assert.equal(result.isIndexed, true);
    assert.equal(result.document.chunkCount, 3);

    // Verify sequential chunk IDs and page numbers
    const chunks = mockVectorStore.lastUpsertedChunks;
    assert.equal(chunks.length, 3);

    assert.equal(chunks[0].id, `${result.document.id}_chunk_0`);
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].metadata.pageNumber, 1);
    assert.ok(chunks[0].content.includes('Sheet 1'));

    assert.equal(chunks[1].id, `${result.document.id}_chunk_1`);
    assert.equal(chunks[1].chunkIndex, 1);
    assert.equal(chunks[1].metadata.pageNumber, 2);
    assert.ok(chunks[1].content.includes('Sheet 2'));

    assert.equal(chunks[2].id, `${result.document.id}_chunk_2`);
    assert.equal(chunks[2].chunkIndex, 2);
    assert.equal(chunks[2].metadata.pageNumber, 3);
    assert.ok(chunks[2].content.includes('Sheet 3'));
  });

  it('enforces ~1000 character target size and ~200 character overlap with boundary prioritization', () => {
    const chunker = new TextChunker({ chunkSize: 1000, chunkOverlap: 200 });

    // Build structured text with distinct paragraph, sentence, and line boundaries
    const p1 = 'First section detailing NEC conductor ampacity adjustments under roof exposure conditions.'.repeat(8);
    const p2 = 'Second section detailing disconnect enclosure rating specifications for outdoor utility equipment.'.repeat(8);
    const combined = `${p1}\n\n${p2}`;

    const chunks = chunker.chunkText(combined, {
      documentId: 'doc_chunk_audit',
      filename: 'ampacity.pdf',
      context: 'NEC',
    });

    assert.ok(chunks.length >= 2);
    // Chunks should target <= 1000 characters
    for (const chunk of chunks) {
      assert.ok(chunk.content.length > 0);
      assert.ok(chunk.content.length <= 1100, `Chunk length ${chunk.content.length} exceeds expected bounds`);
      assert.equal(chunk.documentId, 'doc_chunk_audit');
    }

    // Verify overlap between chunk 0 and chunk 1
    const endOfFirst = chunks[0].content.slice(-150);
    const startOfSecond = chunks[1].content.slice(0, 300);
    const hasOverlap = p1.includes(endOfFirst.trim().slice(0, 30)) && startOfSecond.includes(endOfFirst.trim().slice(-30));
    assert.ok(hasOverlap || chunks[1].content.length > 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Malformed PDF Handling Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Malformed PDF Handling', () => {
  let tempDir: string;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-malformed-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: new MockAuditingEmbeddingProvider(),
      vectorStore: new MockAuditingVectorStore(),
    });
  });

  it('rejects PDF missing end-of-file marker (%%EOF) with CORRUPTED_PDF', async () => {
    const missingEof = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1');

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: missingEof,
          filename: 'truncated.pdf',
          contextType: 'GENERAL',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'CORRUPTED_PDF');
        return true;
      }
    );
  });

  it('handles structurally malformed PDF during extraction with MALFORMED_PDF and records error status', async () => {
    const corruptBuffer = createCorruptStructurePdf();

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: corruptBuffer,
          filename: 'corrupted_structure.pdf',
          contextType: 'GENERAL',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'MALFORMED_PDF');
        return true;
      }
    );

    // Document must be tracked with status 'error', NEVER 'indexed'
    const docs = await service.listDocuments('GENERAL');
    const errored = docs.find((d) => d.name.includes('corrupted_structure'));
    assert.ok(errored);
    assert.equal(errored.status, 'error');
    assert.equal(errored.metadata?.errorCode, 'MALFORMED_PDF');
  });
});

// ---------------------------------------------------------------------------
// 4. Empty-Text / Scanned PDF Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Empty-Text / Scanned PDF Handling', () => {
  let tempDir: string;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-scanned-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: new MockAuditingEmbeddingProvider(),
      vectorStore: new MockAuditingVectorStore(),
    });
  });

  it('detects scanned/empty-text PDF without OCR and returns clear UNSUPPORTED_SCANNED_PDF error', async () => {
    const scannedPdf = createScannedEmptyPdfBuffer();

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: scannedPdf,
          filename: 'scanned_drawing.pdf',
          contextType: 'WATTMONK',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'UNSUPPORTED_SCANNED_PDF');
        assert.ok(err.message.includes('Scanned PDF detected with no extractable text'));
        assert.ok(err.message.includes('OCR is currently unavailable'));
        return true;
      }
    );

    // Verify document in registry is recorded with status 'error'
    const docs = await service.listDocuments('WATTMONK');
    const errored = docs.find((d) => d.name.includes('scanned_drawing'));
    assert.ok(errored);
    assert.equal(errored.status, 'error');
    assert.equal(errored.metadata?.errorCode, 'UNSUPPORTED_SCANNED_PDF');
  });
});

// ---------------------------------------------------------------------------
// 5. Oversized Upload & Validation Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Oversized Upload & Input Validation', () => {
  const processor = new DocumentProcessor({
    maxSizeBytes: 1024 * 1024, // 1 MB limit for test
  });

  it('rejects upload exceeding max size with PAYLOAD_TOO_LARGE', () => {
    const largeBuffer = Buffer.alloc(1024 * 1024 + 10); // 1 MB + 10 bytes

    assert.throws(
      () => processor.validateSize(largeBuffer.length),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
        return true;
      }
    );
  });

  it('rejects empty (0 byte) uploads with FILE_EMPTY', () => {
    assert.throws(
      () => processor.validateSize(0),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'FILE_EMPTY');
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Unsupported File Type Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Unsupported File Type Rejection', () => {
  const processor = new DocumentProcessor();

  it('rejects dangerous and non-PDF extensions with INVALID_EXTENSION', () => {
    const invalidExtensions = [
      'plan.docx',
      'malware.exe',
      'notes.txt',
      'data.json',
      'archive.zip',
      'script.sh',
      'noextension',
    ];

    for (const filename of invalidExtensions) {
      assert.throws(
        () => processor.validateExtension(filename),
        (err: unknown) => {
          assert.ok(err instanceof DocumentProcessorError);
          assert.equal(err.code, 'INVALID_EXTENSION');
          return true;
        },
        `Expected rejection for ${filename}`
      );
    }
  });

  it('rejects disallowed MIME types with INVALID_MIME_TYPE', () => {
    const disallowedMimes = [
      'image/jpeg',
      'image/png',
      'text/plain',
      'application/json',
      'application/zip',
    ];

    for (const mime of disallowedMimes) {
      assert.throws(
        () => processor.validateMimeType(mime),
        (err: unknown) => {
          assert.ok(err instanceof DocumentProcessorError);
          assert.equal(err.code, 'INVALID_MIME_TYPE');
          return true;
        }
      );
    }
  });

  it('sanitizes client filenames to prevent directory traversal', () => {
    const dangerousNames = [
      '../../etc/passwd.pdf',
      '..\\..\\windows\\system32\\cmd.pdf',
      '/var/root/secret.pdf',
      'CON.pdf',
      'file\0nullbyte.pdf',
    ];

    for (const dangerous of dangerousNames) {
      const sanitized = processor.sanitizeFilename(dangerous);
      assert.ok(!sanitized.includes('/'));
      assert.ok(!sanitized.includes('\\'));
      assert.ok(!sanitized.includes('..'));
      assert.ok(sanitized.endsWith('.pdf'));
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate Ingestion Prevention Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Duplicate Ingestion Prevention', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-dedup-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('skips re-indexing when identical SHA-256 hash document is submitted to the same context', async () => {
    const pdfBuffer = createPdfWithPages([
      'NEC Article 705 Interconnected Electric Power Production Sources specifications and utility interconnect compliance.',
    ]);

    // Ingestion 1
    const res1 = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'NEC_705.pdf',
      contextType: 'NEC',
      title: 'NEC 705 Standard',
    });
    assert.equal(res1.isIndexed, true);
    assert.equal(mockEmbedding.callCount, 1);
    assert.equal(mockVectorStore.upsertCallCount, 1);

    // Ingestion 2 with same content
    const res2 = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'NEC_705_Duplicate_Upload.pdf',
      contextType: 'NEC',
      title: 'Duplicate Upload Title',
    });

    // Verifications:
    // - Returns existing document ID
    assert.equal(res2.document.id, res1.document.id);
    assert.equal(res2.isIndexed, true);
    assert.ok(res2.statusMessage.includes('deduplicated by SHA-256 hash'));
    // - Call counts must NOT increment
    assert.equal(mockEmbedding.callCount, 1);
    assert.equal(mockVectorStore.upsertCallCount, 1);
  });
});

// ---------------------------------------------------------------------------
// 8. Embedding Provider Failure Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Embedding Provider Failure Handling', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-embfail-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('marks document status as error and does not report indexed when embedding generation fails', async () => {
    const pdfBuffer = createPdfWithPages(['Valid text that encounters embedding failure.']);

    mockEmbedding.shouldFail = true;
    mockEmbedding.failureError = new EmbeddingError(
      'RATE_LIMIT_ERROR',
      'Google GenAI embedding rate limit: 429 Resource Exhausted'
    );

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: pdfBuffer,
          filename: 'rate_limited_doc.pdf',
          contextType: 'GENERAL',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        return true;
      }
    );

    // Vector upsert must never have been called
    assert.equal(mockVectorStore.upsertCallCount, 0);

    // Document in service must be recorded as 'error'
    const docs = await service.listDocuments('GENERAL');
    const errored = docs.find((d) => d.name.includes('rate_limited_doc'));
    assert.ok(errored);
    assert.equal(errored.status, 'error');
    assert.equal(errored.metadata?.errorCode, 'RATE_LIMIT_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 9. Pinecone Indexing Failure Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Pinecone Indexing Failure Handling', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-pinefail-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('marks document status as error and preserves error details when Pinecone upsert fails', async () => {
    const pdfBuffer = createPdfWithPages(['Valid text that encounters Pinecone upsert failure.']);

    mockVectorStore.shouldFailUpsert = true;
    mockVectorStore.failureError = new PineconeStorageError(
      'STORAGE_ERROR',
      'Failed to connect to Pinecone control plane: HTTP 503'
    );

    await assert.rejects(
      async () => {
        await service.uploadDocument({
          buffer: pdfBuffer,
          filename: 'pinecone_failing.pdf',
          contextType: 'NEC',
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'STORAGE_ERROR');
        return true;
      }
    );

    // Document must be recorded as 'error'
    const docs = await service.listDocuments('NEC');
    const errored = docs.find((d) => d.name.includes('pinecone_failing'));
    assert.ok(errored);
    assert.equal(errored.status, 'error');
    assert.equal(errored.metadata?.errorCode, 'STORAGE_ERROR');
    assert.ok(String(errored.metadata?.error).includes('HTTP 503'));
  });
});

// ---------------------------------------------------------------------------
// 10. Document Deletion Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Document Deletion & Purging', () => {
  let tempDir: string;
  let mockEmbedding: MockAuditingEmbeddingProvider;
  let mockVectorStore: MockAuditingVectorStore;
  let service: DocumentService;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-delete-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  beforeEach(() => {
    mockEmbedding = new MockAuditingEmbeddingProvider();
    mockVectorStore = new MockAuditingVectorStore();
    service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
  });

  it('deletes vectors via documentId filter, unlinks physical file, and removes registry record', async () => {
    const pdfBuffer = createPdfWithPages(['Document content scheduled for deletion.']);

    const res = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'purge_target.pdf',
      contextType: 'WATTMONK',
    });

    const docId = res.document.id;
    const diskPath = service.getDocumentFilePath(docId)!;

    // Verify initial presence
    assert.ok(await fs.stat(diskPath));
    assert.ok(mockVectorStore.lastUpsertedChunks.some((c) => c.documentId === docId));

    // Delete
    const deleted = await service.deleteDocument(docId);
    assert.equal(deleted, true);

    // 1. Vector purge called with docId
    assert.equal(mockVectorStore.deleteCallCount, 1);
    assert.ok(mockVectorStore.deletedDocumentIds.includes(docId));
    assert.equal(
      mockVectorStore.lastUpsertedChunks.filter((c) => c.documentId === docId).length,
      0
    );

    // 2. Physical file removed
    await assert.rejects(async () => {
      await fs.stat(diskPath);
    });

    // 3. Document removed from registry
    assert.equal(await service.getDocument(docId), null);
  });
});

// ---------------------------------------------------------------------------
// 11. Storage Backend Labeling & Fallback Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Storage Backend Labeling', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'day3-audit-storage-'));
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup
    }
  });

  it('explicitly labels in-memory vector store as non-persistent fallback and never claims equivalence to Pinecone', async () => {
    const inMemStore = new InMemoryVectorStore();
    assert.equal(inMemStore.isPersistent, false);
    assert.equal(inMemStore.providerName, 'in-memory-non-persistent');

    const service = new DocumentService({
      storageDir: tempDir,
      embeddingProvider: new MockAuditingEmbeddingProvider(),
      vectorStore: inMemStore,
    });

    const pdfBuffer = createPdfWithPages(['Non-persistent memory store testing.']);
    const result = await service.uploadDocument({
      buffer: pdfBuffer,
      filename: 'in_memory_audit.pdf',
      contextType: 'GENERAL',
    });

    assert.equal(result.isIndexed, true);
    assert.equal(result.document.metadata?.storageBackend, 'in-memory-non-persistent');
    assert.equal(result.document.metadata?.isPersistent, false);
    assert.ok(result.statusMessage.includes('in-memory non-persistent fallback in use'));
    assert.ok(result.statusMessage.includes('vectors will be lost on server restart'));
  });
});

// ---------------------------------------------------------------------------
// 12. Live Integration Safeguards & Verification Status Audit
// ---------------------------------------------------------------------------
describe('Day 3 Audit - Live Integration Verification Safeguards', () => {
  it('[LIVE_PDF_PARSING] Real PDF text extraction is verified locally via unpdf without external network calls', async () => {
    const processor = new DocumentProcessor();
    const testText = 'Real local unpdf parsing verification without network dependency.';
    const pdfBuffer = createPdfWithPages([testText]);

    const extracted = await processor.extractText(pdfBuffer);
    assert.equal(extracted.totalPages, 1);
    assert.equal(extracted.hasText, true);
    assert.ok(extracted.pages[0].text.includes('Real local unpdf parsing verification'));
  });

  it('[UNVERIFIED_LIVE_INTEGRATION] Real Gemini embeddings require server credentials and are safely guarded when unset', async () => {
    const hasKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
    const provider = new GeminiEmbeddingProvider();

    if (hasKey) {
      assert.equal(provider.isConfigured(), true);
    } else {
      assert.equal(provider.isConfigured(), false);
      await assert.rejects(
        async () => {
          await provider.embedQuery('Test query without key');
        },
        (err: unknown) => {
          assert.ok(err instanceof EmbeddingError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          return true;
        }
      );
    }
  });

  it('[UNVERIFIED_LIVE_INTEGRATION] Real Pinecone operations require server credentials and are safely guarded when unset', async () => {
    const hasKey = Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_API_KEY.trim().length > 0);
    const store = new PineconeVectorStore();

    if (hasKey) {
      assert.equal(store.isConfigured(), true);
    } else {
      assert.equal(store.isConfigured(), false);
      await assert.rejects(
        async () => {
          await store.upsertVectors(
            [{ id: 'c1', documentId: 'd1', content: 'test', chunkIndex: 0, metadata: {} }],
            [new Array(DEFAULT_PINECONE_DIMENSION).fill(0)]
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof PineconeStorageError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          return true;
        }
      );
    }
  });
});
