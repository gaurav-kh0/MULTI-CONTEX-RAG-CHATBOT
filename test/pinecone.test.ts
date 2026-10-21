import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PineconeVectorStore,
  PineconeStorageError,
  DEFAULT_PINECONE_INDEX_NAME,
  DEFAULT_PINECONE_DIMENSION,
} from '../backend/storage/pinecone.ts';
import type { DocumentChunk } from '../lib/types.ts';

// Helper to create valid 768-dimensional float vectors
function createVector(dimension = 768, seed = 0.01): number[] {
  const vec = new Array(dimension);
  for (let i = 0; i < dimension; i++) {
    vec[i] = Number(((i * 0.002 + seed) % 1).toFixed(6));
  }
  return vec;
}

// Helper to create test document chunks
function createTestChunk(
  documentId: string,
  chunkIndex: number,
  content: string,
  context: 'NEC' | 'WATTMONK' | 'GENERAL' = 'NEC'
): DocumentChunk {
  return {
    id: `${documentId}_chunk_${chunkIndex}`,
    documentId,
    content,
    chunkIndex,
    metadata: {
      documentId,
      chunkIndex,
      context,
      filename: `${documentId}.pdf`,
      pageNumber: 1,
      title: `${context} Reference Article`,
    },
  };
}

describe('PineconeVectorStore - Configuration & Readiness', () => {
  it('reads default index configuration and reports dimension 768', () => {
    const store = new PineconeVectorStore({
      apiKey: 'test-key',
    });

    assert.equal(store.indexName, DEFAULT_PINECONE_INDEX_NAME);
    assert.equal(store.indexName, 'multi-context-rag');
    assert.equal(store.dimension, DEFAULT_PINECONE_DIMENSION);
    assert.equal(store.dimension, 768);
    assert.equal(store.isConfigured(), true);
  });

  it('reports unconfigured status and throws CONFIGURATION_ERROR when unconfigured', async () => {
    const origKey = process.env.PINECONE_API_KEY;
    delete process.env.PINECONE_API_KEY;

    try {
      const store = new PineconeVectorStore({
        apiKey: undefined,
        client: null,
      });

      assert.equal(store.isConfigured(), false);

      await assert.rejects(
        async () => store.checkIndexReadiness(),
        (err: unknown) => {
          assert.ok(err instanceof PineconeStorageError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.ok(err.message.includes('PINECONE_API_KEY'));
          return true;
        }
      );
    } finally {
      if (origKey) process.env.PINECONE_API_KEY = origKey;
    }
  });

  it('checks index readiness against Pinecone control plane', async () => {
    let describedIndex = '';
    const mockClient = {
      async describeIndex(name: string) {
        describedIndex = name;
        return {
          name,
          dimension: 768,
          metric: 'cosine',
          host: 'https://multi-context-rag-12345.svc.pinecone.io',
          status: { ready: true, state: 'Ready' },
        };
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const status = await store.checkIndexReadiness();

    assert.equal(describedIndex, 'multi-context-rag');
    assert.equal(status.ready, true);
    assert.equal(status.name, 'multi-context-rag');
    assert.equal(status.dimension, 768);
    assert.equal(status.metric, 'cosine');
  });

  it('detects dimension mismatch between Pinecone index and embedding model', async () => {
    const mockClient = {
      async describeIndex() {
        return {
          name: 'multi-context-rag',
          dimension: 1536, // Mismatched dimension (e.g. OpenAI ada-002 instead of 768)
          metric: 'cosine',
          status: { ready: true, state: 'Ready' },
        };
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: mockClient,
      dimension: 768,
    });

    await assert.rejects(
      async () => store.checkIndexReadiness(),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'DIMENSION_MISMATCH');
        assert.ok(err.message.includes('Index dimension mismatch'));
        assert.ok(err.message.includes('1536'));
        assert.ok(err.message.includes('768'));
        return true;
      }
    );
  });

  it('detects missing Pinecone index and instructs manual creation without creating index silently', async () => {
    let createCalled = false;
    const mockClient = {
      async describeIndex() {
        const err = new Error('Index not found [404]');
        throw err;
      },
      async createIndex() {
        createCalled = true;
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: mockClient,
    });

    await assert.rejects(
      async () => store.checkIndexReadiness(),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'INDEX_NOT_FOUND');
        assert.equal(err.statusCode, 404);
        assert.ok(err.message.includes('was not found'));
        return true;
      }
    );

    // Strictly ensure index was NOT created silently
    assert.equal(createCalled, false);
  });
});

describe('PineconeVectorStore - Upsert Operations & Deterministic IDs', () => {
  it('generates deterministic vector IDs for idempotent storage', () => {
    const store = new PineconeVectorStore({ apiKey: 'k' });

    const id1 = store.generateDeterministicId('doc_nec_690', 0);
    const id2 = store.generateDeterministicId('doc_nec_690', 0);
    const id3 = store.generateDeterministicId('doc_nec_690', 1);

    assert.equal(id1, 'doc_nec_690_chunk_0');
    assert.equal(id1, id2); // Stable and deterministic
    assert.notEqual(id1, id3);

    // Sanitizes special characters in IDs
    const idSpecial = store.generateDeterministicId('doc/with spaces & symbols!', 5);
    assert.equal(idSpecial, 'doc_with_spaces___symbols__chunk_5');
  });

  it('upserts vectors with metadata and validates 768 dimensions', async () => {
    let upsertPayload: any = null;

    const mockIndex = {
      async upsert(records: any) {
        upsertPayload = records;
      },
    };

    const mockClient = {
      index() {
        return mockIndex;
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const chunk1 = createTestChunk('doc_nec_690', 0, 'Article 690.12 Rapid Shutdown specifies 80V boundary.', 'NEC');
    const chunk2 = createTestChunk('doc_nec_690', 1, 'Article 690.8 Conductor ampacity calculations.', 'NEC');

    const vector1 = createVector(768, 0.1);
    const vector2 = createVector(768, 0.2);

    await store.upsertVectors([chunk1, chunk2], [vector1, vector2]);

    assert.ok(upsertPayload);
    assert.equal(upsertPayload.length, 2);

    // Record 0 verification
    assert.equal(upsertPayload[0].id, 'doc_nec_690_chunk_0');
    assert.equal(upsertPayload[0].values.length, 768);
    assert.equal(upsertPayload[0].metadata.documentId, 'doc_nec_690');
    assert.equal(upsertPayload[0].metadata.chunkIndex, 0);
    assert.equal(upsertPayload[0].metadata.context, 'NEC');
    assert.equal(upsertPayload[0].metadata.text, chunk1.content);
    assert.equal(upsertPayload[0].metadata.filename, 'doc_nec_690.pdf');

    // Record 1 verification
    assert.equal(upsertPayload[1].id, 'doc_nec_690_chunk_1');
    assert.equal(upsertPayload[1].values.length, 768);
    assert.equal(upsertPayload[1].metadata.chunkIndex, 1);
  });

  it('rejects vectors with dimension mismatch on upsert', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {},
    });

    const chunk = createTestChunk('doc_test', 0, 'Short test content.');
    const shortVector = createVector(512); // Expected 768

    await assert.rejects(
      async () => store.upsertVectors([chunk], [shortVector]),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'DIMENSION_MISMATCH');
        assert.ok(err.message.includes('expected 768'));
        return true;
      }
    );
  });

  it('rejects vectors with non-numeric or NaN values', async () => {
    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {},
    });

    const chunk = createTestChunk('doc_test', 0, 'Short test content.');
    const nanVector = createVector(768);
    nanVector[50] = NaN;

    await assert.rejects(
      async () => store.upsertVectors([chunk], [nanVector]),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('non-numeric element'));
        return true;
      }
    );
  });

  it('partitions large batches exceeding 100 into multiple sub-batch calls', async () => {
    const calls: any[] = [];
    const mockIndex = {
      async upsert(records: any) {
        calls.push(records);
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    // 150 items -> 2 calls (100 + 50)
    const chunks = Array.from({ length: 150 }, (_, i) =>
      createTestChunk('doc_batch', i, `Passage content ${i}`)
    );
    const vectors = Array.from({ length: 150 }, () => createVector(768));

    await store.upsertVectors(chunks, vectors);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].length, 100);
    assert.equal(calls[1].length, 50);
  });
});

describe('PineconeVectorStore - Query & Partition Filtering', () => {
  it('queries vector store with context scope filter (NEC & WATTMONK)', async () => {
    let capturedQuery: any = null;

    const mockIndex = {
      async query(params: any) {
        capturedQuery = params;
        return {
          matches: [
            {
              id: 'doc_nec_690_chunk_0',
              score: 0.92,
              metadata: {
                documentId: 'doc_nec_690',
                chunkIndex: 0,
                text: 'Rapid shutdown initiation guidelines per NEC 690.12.',
                context: 'NEC',
                filename: 'NEC_2023_690.pdf',
                pageNumber: 1,
              },
            },
          ],
        };
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    const queryVector = createVector(768, 0.77);
    const results = await store.querySimilar(queryVector, {
      topK: 5,
      contexts: ['NEC', 'WATTMONK'],
      minScoreThreshold: 0.8,
    });

    // Verify Pinecone query payload
    assert.equal(capturedQuery.topK, 5);
    assert.equal(capturedQuery.includeMetadata, true);
    assert.deepEqual(capturedQuery.filter, {
      context: { $in: ['NEC', 'WATTMONK'] },
    });

    // Verify reconstructed results
    assert.equal(results.length, 1);
    assert.equal(results[0].score, 0.92);
    assert.equal(results[0].documentName, 'NEC_2023_690.pdf');
    assert.equal(results[0].contextType, 'NEC');
    assert.equal(results[0].chunk.id, 'doc_nec_690_chunk_0');
    assert.equal(results[0].chunk.documentId, 'doc_nec_690');
    assert.equal(results[0].chunk.content, 'Rapid shutdown initiation guidelines per NEC 690.12.');
    assert.equal(results[0].chunk.metadata.pageNumber, 1);
  });

  it('filters by both context and documentId using $and query filter', async () => {
    let capturedQuery: any = null;

    const mockIndex = {
      async query(params: any) {
        capturedQuery = params;
        return { matches: [] };
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    const queryVector = createVector(768);
    await store.querySimilar(queryVector, {
      contexts: ['WATTMONK'],
      documentId: 'doc_wm_plansets',
    });

    assert.deepEqual(capturedQuery.filter, {
      $and: [
        { context: { $eq: 'WATTMONK' } },
        { documentId: { $eq: 'doc_wm_plansets' } },
      ],
    });
  });

  it('filters out matches below minScoreThreshold', async () => {
    const mockIndex = {
      async query() {
        return {
          matches: [
            { id: 'c1', score: 0.88, metadata: { text: 'High score match' } },
            { id: 'c2', score: 0.65, metadata: { text: 'Low score match' } },
          ],
        };
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    const results = await store.querySimilar(createVector(768), {
      minScoreThreshold: 0.85,
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].chunk.id, 'c1');
    assert.equal(results[0].score, 0.88);
  });
});

describe('PineconeVectorStore - Deletion & Namespace Routing', () => {
  it('deletes vectors associated with a document ID via deleteMany filter', async () => {
    let deleteParams: any = null;

    const mockIndex = {
      async deleteMany(params: any) {
        deleteParams = params;
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    await store.deleteByDocumentId('doc_nec_690');

    assert.deepEqual(deleteParams, {
      filter: {
        documentId: { $eq: 'doc_nec_690' },
      },
    });
  });

  it('rejects empty document ID on deletion', async () => {
    const store = new PineconeVectorStore({ apiKey: 'k', client: {} });

    await assert.rejects(
      async () => store.deleteByDocumentId(''),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  it('routes operations to specific namespace when configured', async () => {
    let capturedNamespace = '';
    const mockNamespaceIndex = {
      async upsert() {},
    };

    const mockIndex = {
      namespace(ns: string) {
        capturedNamespace = ns;
        return mockNamespaceIndex;
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      namespace: 'tenant_solar_co',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    const chunk = createTestChunk('doc_ns', 0, 'Namespaced content');
    await store.upsertVectors([chunk], [createVector(768)]);

    assert.equal(capturedNamespace, 'tenant_solar_co');
  });
});

describe('PineconeVectorStore - Error Handling & Credential Redaction', () => {
  it('translates HTTP 401 / unauthorized into AUTHENTICATION_ERROR and redacts API key', async () => {
    const secretKey = 'pcsk_live_secret_key_1234567890';
    const mockClient = {
      async describeIndex() {
        throw new Error(`Unauthorized: Key ${secretKey} was rejected [401].`);
      },
    };

    const store = new PineconeVectorStore({
      apiKey: secretKey,
      client: mockClient,
    });

    await assert.rejects(
      async () => store.checkIndexReadiness(),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'AUTHENTICATION_ERROR');
        assert.equal(err.statusCode, 401);
        // Verify key is redacted
        assert.ok(!err.message.includes(secretKey));
        assert.ok(err.message.includes('[REDACTED_API_KEY]'));
        return true;
      }
    );
  });

  it('translates HTTP 429 into RATE_LIMIT_ERROR', async () => {
    const mockIndex = {
      async query() {
        throw new Error('Too many requests. Rate limit exceeded [429].');
      },
    };

    const store = new PineconeVectorStore({
      apiKey: 'mock-key',
      client: {
        index() {
          return mockIndex;
        },
      },
    });

    await assert.rejects(
      async () => store.querySimilar(createVector(768)),
      (err: unknown) => {
        assert.ok(err instanceof PineconeStorageError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 429);
        return true;
      }
    );
  });
});
