import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  DocumentProcessor,
  DocumentProcessorError,
} from '../backend/rag/document-processor.ts';
import {
  DocumentService,
} from '../backend/services/document-service.ts';
import { POST, GET } from '../app/api/documents/route.ts';

// Helper to build a minimal valid PDF byte buffer
function createMinimalValidPdfBuffer(version = '1.7', content = 'Minimal valid test PDF'): Buffer {
  const body = `%PDF-${version}\n1 0 obj\n<< /Title (${content}) >>\nendobj\n%%EOF\n`;
  return Buffer.from(body, 'utf-8');
}

// Helper to build a truncated PDF missing %%EOF
function createTruncatedPdfBuffer(): Buffer {
  const body = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
  return Buffer.from(body, 'utf-8');
}

describe('DocumentProcessor - Low-Level PDF Validation & Ingestion', () => {
  const processor = new DocumentProcessor({
    maxSizeBytes: 5 * 1024 * 1024, // 5 MB for testing
  });

  it('validates safe and dangerous filename extensions', () => {
    // Valid
    assert.doesNotThrow(() => processor.validateExtension('report.pdf'));
    assert.doesNotThrow(() => processor.validateExtension('document.PDF'));
    assert.doesNotThrow(() => processor.validateExtension('MY_FILE.pdf'));

    // Invalid
    assert.throws(
      () => processor.validateExtension('document.txt'),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_EXTENSION'
    );
    assert.throws(
      () => processor.validateExtension('payload.exe'),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_EXTENSION'
    );
    assert.throws(
      () => processor.validateExtension('no_extension'),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_EXTENSION'
    );
    assert.throws(
      () => processor.validateExtension(''),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_EXTENSION'
    );
  });

  it('validates MIME types appropriately', () => {
    // Allowed
    assert.doesNotThrow(() => processor.validateMimeType('application/pdf'));
    assert.doesNotThrow(() => processor.validateMimeType('application/x-pdf'));
    assert.doesNotThrow(() => processor.validateMimeType(undefined));

    // Rejected
    assert.throws(
      () => processor.validateMimeType('image/png'),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_MIME_TYPE'
    );
    assert.throws(
      () => processor.validateMimeType('application/javascript'),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_MIME_TYPE'
    );
  });

  it('enforces size limits (rejects empty and oversized files)', () => {
    // Empty
    assert.throws(
      () => processor.validateSize(0),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'FILE_EMPTY'
    );

    // Within limit
    assert.doesNotThrow(() => processor.validateSize(1024));

    // Exceeds limit (5 MB test limit)
    assert.throws(
      () => processor.validateSize(6 * 1024 * 1024),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'PAYLOAD_TOO_LARGE'
    );
  });

  it('verifies PDF magic byte header signature (%PDF-)', () => {
    const validBuffer = createMinimalValidPdfBuffer('1.7');
    const version = processor.validateSignature(validBuffer);
    assert.equal(version, '1.7');

    // Fake PDF with .pdf name but plain text content
    const fakeBuffer = Buffer.from('This is a text file renamed to .pdf', 'utf-8');
    assert.throws(
      () => processor.validateSignature(fakeBuffer),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_SIGNATURE'
    );

    // Tiny buffer
    const tinyBuffer = Buffer.from('%PD');
    assert.throws(
      () => processor.validateSignature(tinyBuffer),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'INVALID_SIGNATURE'
    );
  });

  it('rejects corrupted/truncated PDFs lacking %%EOF', () => {
    const truncated = createTruncatedPdfBuffer();
    assert.throws(
      () => processor.validateIntegrity(truncated),
      (err: unknown) =>
        err instanceof DocumentProcessorError && err.code === 'CORRUPTED_PDF'
    );

    const validBuffer = createMinimalValidPdfBuffer();
    assert.doesNotThrow(() => processor.validateIntegrity(validBuffer));
  });

  it('sanitizes client-provided filenames and neutralizes directory traversal', () => {
    const traversal1 = '../../../../etc/passwd.pdf';
    const sanitized1 = processor.sanitizeFilename(traversal1);
    assert.ok(!sanitized1.includes('..'));
    assert.ok(!sanitized1.includes('/'));
    assert.equal(sanitized1, 'passwd.pdf');

    const windowsTraversal = '..\\..\\Windows\\System32\\calc.pdf';
    const sanitized2 = processor.sanitizeFilename(windowsTraversal);
    assert.ok(!sanitized2.includes('..'));
    assert.ok(!sanitized2.includes('\\'));
    assert.equal(sanitized2, 'calc.pdf');

    const specialChars = 'My Document <>:"/\\|?* 2024!.pdf';
    const sanitized3 = processor.sanitizeFilename(specialChars);
    assert.ok(!/[<>:"/\\|?*]/.test(sanitized3));
    assert.ok(sanitized3.endsWith('.pdf'));
  });

  it('extracts SHA-256 hash and metadata from valid PDF', () => {
    const valid = createMinimalValidPdfBuffer('1.5', 'Test Doc');
    const meta = processor.process(valid, 'sample_test.pdf', 'application/pdf');

    assert.equal(meta.pdfVersion, '1.5');
    assert.equal(meta.originalFilename, 'sample_test.pdf');
    assert.ok(meta.sha256.length === 64);
    assert.ok(meta.fileSizeBytes > 0);
  });
});

describe('DocumentService - Secure Upload & Storage Isolation', () => {
  let testStorageDir: string;
  let service: DocumentService;

  before(async () => {
    testStorageDir = path.join(os.tmpdir(), `test_rag_storage_${Date.now()}`);
    await fs.mkdir(testStorageDir, { recursive: true });
    service = new DocumentService({ storageDir: testStorageDir });
  });

  after(async () => {
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('uploads valid PDF securely, generates unique ID, and stores on disk outside public dir', async () => {
    const pdfBytes = createMinimalValidPdfBuffer('1.7', 'NEC Article 690 Test');
    const result = await service.uploadDocument({
      buffer: pdfBytes,
      filename: 'NEC_690_Test.pdf',
      contextType: 'NEC',
      title: 'NEC Article 690 Test Document',
      author: 'NFPA Review',
      autoIndex: false,
    });

    // Check payload contracts
    assert.ok(result.document);
    assert.match(result.document.id, /^doc_\d+_[a-f0-9]+$/);
    assert.equal(result.document.name, 'NEC Article 690 Test Document');
    assert.equal(result.document.status, 'uploaded');
    // Requirement: strictly NOT indexed yet
    assert.equal(result.isIndexed, false);
    assert.ok(result.statusMessage.includes('pending text extraction'));

    // Check metadata
    assert.equal(result.document.metadata?.contextType, 'NEC');
    assert.equal(result.document.metadata?.author, 'NFPA Review');
    assert.equal(result.document.metadata?.pdfVersion, '1.7');

    // Verify storage isolation: stored in testStorageDir as ${id}.pdf, NEVER as client filename
    const expectedDiskPath = path.join(testStorageDir, `${result.document.id}.pdf`);
    assert.equal(result.document.metadata?.storagePath, expectedDiskPath);

    // Verify disk content
    const savedBytes = await fs.readFile(expectedDiskPath);
    assert.deepEqual(savedBytes, pdfBytes);
  });

  it('retrieves uploaded document via getDocument and lists filtered by contextType', async () => {
    const pdfBytes = createMinimalValidPdfBuffer('1.4', 'Wattmonk AHJ');
    const result = await service.uploadDocument({
      buffer: pdfBytes,
      filename: 'wattmonk_ahj.pdf',
      contextType: 'WATTMONK',
      autoIndex: false,
    });

    const retrieved = await service.getDocument(result.document.id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, result.document.id);
    assert.equal(retrieved.metadata?.contextType, 'WATTMONK');

    // List by context
    const wattmonkDocs = await service.listDocuments('WATTMONK');
    const found = wattmonkDocs.find((d) => d.id === result.document.id);
    assert.ok(found);

    const necDocs = await service.listDocuments('NEC');
    const notInNec = necDocs.find((d) => d.id === result.document.id);
    assert.equal(notInNec, undefined);
  });
});

describe('API Route /api/documents - HTTP Integration', () => {
  it('handles multipart/form-data PDF upload successfully (HTTP 201)', async () => {
    const pdfBytes = createMinimalValidPdfBuffer('1.7', 'API Route Integration Test');
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });

    const formData = new FormData();
    formData.append('file', blob, 'test_manual.pdf');
    formData.append('contextType', 'GENERAL');
    formData.append('title', 'API Test Manual');
    formData.append('autoIndex', 'false');

    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    assert.equal(res.status, 201);

    const json = (await res.json()) as {
      success: boolean;
      data: {
        document: { id: string; status: string; metadata: { contextType: string } };
        isIndexed: boolean;
      };
    };

    assert.equal(json.success, true);
    assert.equal(json.data.document.status, 'uploaded');
    assert.equal(json.data.isIndexed, false);
    assert.equal(json.data.document.metadata.contextType, 'GENERAL');
  });

  it('rejects multipart upload without file (HTTP 400)', async () => {
    const formData = new FormData();
    formData.append('contextType', 'NEC');

    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    assert.equal(res.status, 400);

    const json = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  });

  it('rejects non-PDF / corrupted file upload with HTTP 400', async () => {
    const invalidBlob = new Blob(['not a real pdf file at all'], {
      type: 'application/pdf',
    });

    const formData = new FormData();
    formData.append('file', invalidBlob, 'fake.pdf');
    formData.append('contextType', 'NEC');

    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    assert.equal(res.status, 400);

    const json = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
    assert.ok(json.error.message.includes('signature'));
  });

  it('preserves backwards-compatible application/json registration (HTTP 201)', async () => {
    const body = {
      title: 'Legacy Registered Specification',
      contextType: 'WATTMONK',
      author: 'Wattmonk Team',
    };

    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    assert.equal(res.status, 201);

    const json = (await res.json()) as {
      success: boolean;
      data: { isIndexed: boolean; document: { id: string } };
    };
    assert.equal(json.success, true);
    assert.equal(json.data.isIndexed, false);
  });

  it('rejects invalid contextType in multipart upload with HTTP 400', async () => {
    const pdfBytes = createMinimalValidPdfBuffer('1.7');
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });

    const formData = new FormData();
    formData.append('file', blob, 'sample.pdf');
    formData.append('contextType', 'INVALID_CONTEXT');

    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: formData,
    });

    const res = await POST(req);
    assert.equal(res.status, 400);

    const json = (await res.json()) as { success: boolean; error: { code: string } };
    assert.equal(json.success, false);
    assert.equal(json.error.code, 'VALIDATION_ERROR');
  });

  it('rejects oversized file uploads with HTTP 413 (PAYLOAD_TOO_LARGE)', async () => {
    // Set environment variable to lower limit for testing
    const originalLimit = process.env.MAX_UPLOAD_SIZE_BYTES;
    process.env.MAX_UPLOAD_SIZE_BYTES = '50'; // 50 bytes

    try {
      const pdfBytes = createMinimalValidPdfBuffer('1.7', 'This PDF content exceeds 50 bytes');
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });

      const formData = new FormData();
      formData.append('file', blob, 'large.pdf');
      formData.append('contextType', 'NEC');

      const req = new Request('http://localhost/api/documents', {
        method: 'POST',
        body: formData,
      });

      const res = await POST(req);
      assert.equal(res.status, 413);

      const json = (await res.json()) as { success: boolean; error: { code: string } };
      assert.equal(json.success, false);
      assert.equal(json.error.code, 'PAYLOAD_TOO_LARGE');
    } finally {
      if (originalLimit !== undefined) {
        process.env.MAX_UPLOAD_SIZE_BYTES = originalLimit;
      } else {
        delete process.env.MAX_UPLOAD_SIZE_BYTES;
      }
    }
  });

  it('lists documents via GET /api/documents', async () => {
    const req = new Request('http://localhost/api/documents?contextType=NEC', {
      method: 'GET',
    });

    const res = await GET(req);
    assert.equal(res.status, 200);

    const json = (await res.json()) as { success: boolean; data: unknown[] };
    assert.equal(json.success, true);
    assert.ok(Array.isArray(json.data));
    assert.ok(json.data.length > 0);
  });
});
