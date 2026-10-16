import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SearchService,
  SearchError,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
} from '../backend/services/search-service.ts';
import {
  RagRetriever,
  RetrieverError,
} from '../backend/rag/retriever.ts';
import {
  EmbeddingError,
  EMBEDDING_DIMENSIONS,
} from '../backend/rag/embeddings.ts';
import {
  PineconeStorageError,
} from '../backend/storage/pinecone.ts';
import { POST, GET, PUT, DELETE, PATCH } from '../app/api/search/route.ts';
import type {
  ContextType,
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
  ApiResponse,
  SearchResponsePayload,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// Mock Implementations for Controlled Deterministic Testing
// ---------------------------------------------------------------------------

class MockSearchEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Mock Search Embedding Provider';
  configured = true;
  shouldFail = false;
  failureError?: Error;

  isConfigured(): boolean {
    return this.configured;
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    return this.embedQuery(_text);
  }

  async embedQuery(_query: string): Promise<number[]> {
    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding network failure');
    }
    return new Array(EMBEDDING_DIMENSIONS).fill(0.15);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.15));
  }
}

class MockSearchVectorStore implements IVectorStore {
  readonly isPersistent = true;
  configured = true;
  shouldFail = false;
  failureError?: Error;
  stagedMatches: RagRetrievalResult[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async upsertVectors(_chunks: DocumentChunk[], _vectors: number[][]): Promise<void> {}

  async deleteByDocumentId(_documentId: string): Promise<void> {}

  async querySimilar(
    _vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    if (this.shouldFail) {
      throw this.failureError || new PineconeStorageError('STORAGE_ERROR', 'Simulated Pinecone storage query failure');
    }

    let results = [...this.stagedMatches];

    // Filter by context
    if (options?.contexts && options.contexts.length > 0) {
      results = results.filter((r) =>
        options.contexts!.includes(r.chunk.metadata.context as ContextType)
      );
    }

    // Filter by documentId
    if (options?.documentId) {
      results = results.filter((r) => r.chunk.documentId === options.documentId);
    }

    // Filter by minScoreThreshold
    if (options?.minScoreThreshold !== undefined) {
      results = results.filter((r) => r.score >= options.minScoreThreshold!);
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    if (options?.topK && options.topK > 0) {
      return results.slice(0, options.topK);
    }

    return results;
  }
}

function createSampleMatches(): RagRetrievalResult[] {
  return [
    {
      chunk: {
        id: 'nec_chunk_1',
        documentId: 'doc_nec_2023',
        content: 'NEC Article 690.12 requires rapid shutdown for all PV systems installed on buildings.',
        chunkIndex: 1,
        metadata: {
          documentId: 'doc_nec_2023',
          filename: 'NEC_2023_Article_690.pdf',
          context: 'NEC' as ContextType,
          pageNumber: 42,
          chunkIndex: 1,
        },
      },
      score: 0.89,
      documentName: 'NEC_2023_Article_690.pdf',
      contextType: 'NEC',
    },
    {
      chunk: {
        id: 'nec_chunk_2',
        documentId: 'doc_nec_2023',
        content: 'Conductors located inside the PV array boundary shall be limited to 80 volts within 30 seconds.',
        chunkIndex: 2,
        metadata: {
          documentId: 'doc_nec_2023',
          filename: 'NEC_2023_Article_690.pdf',
          context: 'NEC' as ContextType,
          pageNumber: 43,
          chunkIndex: 2,
        },
      },
      score: 0.82,
      documentName: 'NEC_2023_Article_690.pdf',
      contextType: 'NEC',
    },
    {
      chunk: {
        id: 'solar_chunk_1',
        documentId: 'doc_wattmonk_spec',
        content: 'Wattmonk standard design guidelines require DC/AC ratios between 1.15 and 1.30 for string inverters.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_wattmonk_spec',
          filename: 'Wattmonk_Engineering_Guidelines.pdf',
          context: 'WATTMONK' as ContextType,
          chunkIndex: 0,
          // Notice: pageNumber omitted to verify missing page handling
        },
      },
      score: 0.78,
      documentName: 'Wattmonk_Engineering_Guidelines.pdf',
      contextType: 'WATTMONK',
    },
    {
      chunk: {
        id: 'general_chunk_1',
        documentId: 'doc_general_faq',
        content: 'General solar permitting checklist covers electrical line drawings, structural stamps, and site plans.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_general_faq',
          filename: 'Solar_Permitting_FAQ.pdf',
          context: 'GENERAL' as ContextType,
          pageNumber: 3,
          chunkIndex: 0,
        },
      },
      score: 0.68,
      documentName: 'Solar_Permitting_FAQ.pdf',
      contextType: 'GENERAL',
    },
    {
      chunk: {
        id: 'low_score_chunk',
        documentId: 'doc_unrelated',
        content: 'Company vacation policy and paid time off schedules.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_unrelated',
          filename: 'Employee_Handbook.pdf',
          context: 'GENERAL' as ContextType,
          chunkIndex: 0,
        },
      },
      score: 0.45,
      documentName: 'Employee_Handbook.pdf',
      contextType: 'GENERAL',
    },
  ];
}

// ---------------------------------------------------------------------------
// Test Suite: SearchService Unit Tests
// ---------------------------------------------------------------------------

describe('SearchService - Input Validation', () => {
  let mockEmbedding: MockSearchEmbeddingProvider;
  let mockVectorStore: MockSearchVectorStore;
  let retriever: RagRetriever;
  let service: SearchService;

  beforeEach(() => {
    mockEmbedding = new MockSearchEmbeddingProvider();
    mockVectorStore = new MockSearchVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    service = new SearchService({ retriever });
  });

  it('rejects null or non-object search request payloads', async () => {
    await assert.rejects(
      async () => service.executeSearch(null as unknown as { query: string }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /must be an object/i);
        return true;
      }
    );
  });

  it('rejects non-string query values', async () => {
    await assert.rejects(
      async () => service.executeSearch({ query: 12345 as unknown as string }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /must be a string/i);
        return true;
      }
    );
  });

  it('rejects empty or whitespace-only query strings', async () => {
    await assert.rejects(
      async () => service.executeSearch({ query: '   \n  \t  ' }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /empty or whitespace-only/i);
        return true;
      }
    );
  });

  it('rejects queries exceeding 1000 characters', async () => {
    const longQuery = 'A'.repeat(1001);
    await assert.rejects(
      async () => service.executeSearch({ query: longQuery }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /exceeds maximum limit of 1000/i);
        return true;
      }
    );
  });

  it('rejects out-of-range or non-integer limits (topK)', async () => {
    for (const badLimit of [0, -1, 51, 1.5, NaN]) {
      await assert.rejects(
        async () => service.executeSearch({ query: 'valid query', limit: badLimit }),
        (err: unknown) => {
          assert.ok(err instanceof SearchError);
          assert.equal(err.code, 'VALIDATION_ERROR');
          assert.match(err.message, /integer between 1 and 50/i);
          return true;
        }
      );
    }
  });

  it('rejects invalid context partitions', async () => {
    await assert.rejects(
      async () =>
        service.executeSearch({
          query: 'valid query',
          contexts: ['INVALID_CONTEXT' as ContextType],
        }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /Invalid context type/i);
        return true;
      }
    );
  });

  it('rejects unsafe document identifiers (e.g. path traversal)', async () => {
    await assert.rejects(
      async () =>
        service.executeSearch({
          query: 'valid query',
          documentId: '../../etc/passwd',
        }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.match(err.message, /Document ID must be/i);
        return true;
      }
    );
  });
});

describe('SearchService - Filtering and Ranking', () => {
  let mockEmbedding: MockSearchEmbeddingProvider;
  let mockVectorStore: MockSearchVectorStore;
  let retriever: RagRetriever;
  let service: SearchService;

  beforeEach(() => {
    mockEmbedding = new MockSearchEmbeddingProvider();
    mockVectorStore = new MockSearchVectorStore();
    mockVectorStore.stagedMatches = createSampleMatches();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
      minScoreThreshold: 0.60,
    });
    service = new SearchService({ retriever });
  });

  it('filters results strictly by single context partition (NEC)', async () => {
    const response = await service.executeSearch({
      query: 'rapid shutdown requirements',
      contexts: ['NEC'],
    });

    assert.equal(response.isReady, true);
    assert.equal(response.results.length, 2);
    assert.ok(response.results.every((r) => r.contextType === 'NEC'));
    assert.equal(response.results[0].chunkId, 'nec_chunk_1');
    assert.equal(response.results[1].chunkId, 'nec_chunk_2');
  });

  it('filters results strictly by single context partition via context alias', async () => {
    const response = await service.executeSearch({
      query: 'DC/AC inverter sizing',
      context: 'WATTMONK',
    });

    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].contextType, 'WATTMONK');
    assert.equal(response.results[0].documentId, 'doc_wattmonk_spec');
  });

  it('filters results strictly by document ID', async () => {
    const response = await service.executeSearch({
      query: 'solar engineering design',
      documentId: 'doc_wattmonk_spec',
    });

    assert.equal(response.results.length, 1);
    assert.equal(response.results[0].documentId, 'doc_wattmonk_spec');
    assert.equal(response.results[0].filename, 'Wattmonk_Engineering_Guidelines.pdf');
  });

  it('combines context and document ID filters', async () => {
    // Both match doc_nec_2023 in NEC
    const matchResponse = await service.executeSearch({
      query: 'conductor voltage boundary',
      contexts: ['NEC'],
      documentId: 'doc_nec_2023',
    });
    assert.equal(matchResponse.results.length, 2);

    // Mismatched context and docId
    const mismatchResponse = await service.executeSearch({
      query: 'conductor voltage boundary',
      contexts: ['WATTMONK'],
      documentId: 'doc_nec_2023',
    });
    assert.equal(mismatchResponse.results.length, 0);
  });

  it('enforces result limit (topK) and preserves strict score descending order', async () => {
    const response = await service.executeSearch({
      query: 'solar electrical requirements',
      limit: 2,
    });

    assert.equal(response.results.length, 2);
    assert.equal(response.results[0].score, 0.89);
    assert.equal(response.results[1].score, 0.82);
    assert.ok(response.results[0].score >= response.results[1].score);
  });

  it('respects custom minScoreThreshold cutoff', async () => {
    const strictResponse = await service.executeSearch({
      query: 'rapid shutdown',
      minScoreThreshold: 0.85,
    });

    // Only nec_chunk_1 has score 0.89 >= 0.85
    assert.equal(strictResponse.results.length, 1);
    assert.equal(strictResponse.results[0].chunkId, 'nec_chunk_1');
  });
});

describe('SearchService - Metadata and Score Integrity', () => {
  let mockEmbedding: MockSearchEmbeddingProvider;
  let mockVectorStore: MockSearchVectorStore;
  let retriever: RagRetriever;
  let service: SearchService;

  beforeEach(() => {
    mockEmbedding = new MockSearchEmbeddingProvider();
    mockVectorStore = new MockSearchVectorStore();
    mockVectorStore.stagedMatches = createSampleMatches();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
      minScoreThreshold: 0.60,
    });
    service = new SearchService({ retriever });
  });

  it('preserves verified page number when present and leaves undefined when absent (never invented)', async () => {
    const response = await service.executeSearch({
      query: 'solar documents',
      limit: 10,
    });

    const necChunk = response.results.find((r) => r.chunkId === 'nec_chunk_1');
    assert.ok(necChunk);
    assert.equal(necChunk.pageNumber, 42);

    const wattmonkChunk = response.results.find((r) => r.chunkId === 'solar_chunk_1');
    assert.ok(wattmonkChunk);
    // Page was absent in metadata; must NOT invent 1 or any default
    assert.equal(wattmonkChunk.pageNumber, undefined);
  });

  it('preserves exact vector similarity score without fabricating percentages or rounding', async () => {
    const response = await service.executeSearch({
      query: 'NEC rules',
      contexts: ['NEC'],
    });

    assert.equal(response.results[0].score, 0.89);
    assert.equal(typeof response.results[0].score, 'number');
  });

  it('preserves verified excerpt text accurately', async () => {
    const response = await service.executeSearch({
      query: 'rapid shutdown',
      contexts: ['NEC'],
    });

    assert.match(response.results[0].excerpt, /rapid shutdown for all PV systems/i);
  });
});

describe('SearchService - Empty Results Handling', () => {
  let mockEmbedding: MockSearchEmbeddingProvider;
  let mockVectorStore: MockSearchVectorStore;
  let retriever: RagRetriever;
  let service: SearchService;

  beforeEach(() => {
    mockEmbedding = new MockSearchEmbeddingProvider();
    mockVectorStore = new MockSearchVectorStore();
    mockVectorStore.stagedMatches = []; // Empty vector index
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    service = new SearchService({ retriever });
  });

  it('returns empty array and zero totalResults when vector index is empty', async () => {
    const response = await service.executeSearch({
      query: 'what is inverter clipping?',
    });

    assert.equal(response.isReady, true);
    assert.equal(response.results.length, 0);
    assert.equal(response.totalResults, 0);
    assert.match(response.statusMessage!, /No relevant document chunks found/i);
  });

  it('returns empty array when no chunks exceed the relevance threshold', async () => {
    mockVectorStore.stagedMatches = createSampleMatches();
    const response = await service.executeSearch({
      query: 'obscure requirement',
      minScoreThreshold: 0.99, // Unattainably high
    });

    assert.equal(response.results.length, 0);
    assert.equal(response.totalResults, 0);
  });
});

describe('SearchService - Service Failure & Dependency Error Handling', () => {
  it('throws CONFIGURATION_ERROR when embedding provider is unconfigured', async () => {
    const mockEmbedding = new MockSearchEmbeddingProvider();
    mockEmbedding.configured = false;
    const mockVectorStore = new MockSearchVectorStore();

    const retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    const service = new SearchService({ retriever });

    await assert.rejects(
      async () => service.executeSearch({ query: 'NEC rapid shutdown' }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.match(err.message, /Embedding provider is not configured/i);
        return true;
      }
    );
  });

  it('throws EMBEDDING_ERROR when embedding generation fails at runtime', async () => {
    const mockEmbedding = new MockSearchEmbeddingProvider();
    mockEmbedding.shouldFail = true;
    mockEmbedding.failureError = new Error('Google Generative AI quota exceeded');
    const mockVectorStore = new MockSearchVectorStore();

    const retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    const service = new SearchService({ retriever });

    await assert.rejects(
      async () => service.executeSearch({ query: 'NEC rapid shutdown' }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'EMBEDDING_ERROR');
        assert.match(err.message, /quota exceeded/i);
        return true;
      }
    );
  });

  it('throws CONFIGURATION_ERROR when vector store is unconfigured', async () => {
    const mockEmbedding = new MockSearchEmbeddingProvider();
    const mockVectorStore = new MockSearchVectorStore();
    mockVectorStore.configured = false;

    const retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    const service = new SearchService({ retriever });

    await assert.rejects(
      async () => service.executeSearch({ query: 'NEC rapid shutdown' }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.match(err.message, /Vector store is not configured/i);
        return true;
      }
    );
  });

  it('throws STORAGE_ERROR when vector store query fails at runtime', async () => {
    const mockEmbedding = new MockSearchEmbeddingProvider();
    const mockVectorStore = new MockSearchVectorStore();
    mockVectorStore.shouldFail = true;
    mockVectorStore.failureError = new Error('Pinecone connection timeout');

    const retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockVectorStore,
    });
    const service = new SearchService({ retriever });

    await assert.rejects(
      async () => service.executeSearch({ query: 'NEC rapid shutdown' }),
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'STORAGE_ERROR');
        assert.match(err.message, /Pinecone connection timeout/i);
        return true;
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Test Suite: /api/search Route Handler HTTP Tests
// ---------------------------------------------------------------------------

describe('/api/search Route Handler - HTTP POST & GET Contracts', () => {
  it('POST /api/search rejects malformed JSON body with HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{',
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'BAD_REQUEST');
      assert.match(json.error.message, /Malformed JSON/i);
    }
  });

  it('POST /api/search rejects non-object body with HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(['an', 'array']),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'BAD_REQUEST');
    }
  });

  it('POST /api/search rejects missing or empty query with HTTP 400 VALIDATION_ERROR', async () => {
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'VALIDATION_ERROR');
      assert.match(json.error.message, /cannot be empty/i);
    }
  });

  it('POST /api/search rejects out-of-range limit with HTTP 400 VALIDATION_ERROR', async () => {
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'valid query', limit: 99 }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'VALIDATION_ERROR');
      assert.match(json.error.message, /between 1 and 50/i);
    }
  });

  it('POST /api/search rejects malicious documentId with HTTP 400 VALIDATION_ERROR', async () => {
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'valid query', documentId: 'bad/id/with/slashes' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'VALIDATION_ERROR');
      assert.match(json.error.message, /Document ID must be/i);
    }
  });

  it('GET /api/search rejects missing q parameter with HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/search?contexts=NEC', {
      method: 'GET',
    });

    const res = await GET(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    }
  });

  it('GET /api/search rejects invalid context parameter with HTTP 400', async () => {
    const req = new Request('http://localhost:3000/api/search?q=test&contexts=INVALID_CONTEXT', {
      method: 'GET',
    });

    const res = await GET(req);
    assert.equal(res.status, 400);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'VALIDATION_ERROR');
    }
  });

  it('returns HTTP 405 Method Not Allowed for PUT, DELETE, PATCH', async () => {
    const putRes = await PUT();
    assert.equal(putRes.status, 405);
    assert.equal(putRes.headers.get('Allow'), 'GET, POST');

    const delRes = await DELETE();
    assert.equal(delRes.status, 405);

    const patchRes = await PATCH();
    assert.equal(patchRes.status, 405);
  });

  it('POST /api/search returns HTTP 503 SERVICE_UNAVAILABLE when dependencies are unconfigured', async () => {
    // In test environment, GEMINI_API_KEY is not set so default searchService throws CONFIGURATION_ERROR
    const req = new Request('http://localhost:3000/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'NEC rapid shutdown' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 503);
    const json = (await res.json()) as ApiResponse<SearchResponsePayload>;
    assert.equal(json.success, false);
    if (!json.success) {
      assert.equal(json.error.code, 'SERVICE_UNAVAILABLE');
      assert.match(json.error.message, /Embedding provider is not configured/i);
    }
  });
});
