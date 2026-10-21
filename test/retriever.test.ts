import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

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
import type {
  ContextType,
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// Mock Dependencies for Deterministic Offline Testing
// ---------------------------------------------------------------------------

class MockRetrieverEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Mock Retriever Embedding Provider';
  callCount = 0;
  lastQuery = '';
  shouldFail = false;
  failureError?: Error;
  configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embedQuery(text);
  }

  async embedQuery(query: string): Promise<number[]> {
    this.callCount++;
    this.lastQuery = query;

    if (this.shouldFail) {
      throw this.failureError || new EmbeddingError('PROVIDER_ERROR', 'Simulated embedding network failure');
    }

    // Return deterministic 768-dim query vector
    return new Array(EMBEDDING_DIMENSIONS).fill(0.25);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(EMBEDDING_DIMENSIONS).fill(0.25));
  }
}

class MockRetrieverVectorStore implements IVectorStore {
  readonly isPersistent = true;
  queryCallCount = 0;
  lastQueriedVector?: number[];
  lastQueryOptions?: RagQueryOptions;
  shouldFail = false;
  failureError?: Error;
  configured = true;

  // Stored matches to return
  stagedMatches: RagRetrievalResult[] = [];

  isConfigured(): boolean {
    return this.configured;
  }

  async upsertVectors(_chunks: DocumentChunk[], _vectors: number[][]): Promise<void> {}

  async deleteByDocumentId(_documentId: string): Promise<void> {}

  async querySimilar(
    vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    this.queryCallCount++;
    this.lastQueriedVector = vector;
    this.lastQueryOptions = options;

    if (this.shouldFail) {
      throw this.failureError || new PineconeStorageError('STORAGE_ERROR', 'Simulated Pinecone connection timeout');
    }

    // Filter staged matches by context if requested
    let results = [...this.stagedMatches];

    if (options?.contexts && options.contexts.length > 0) {
      results = results.filter((r) => options.contexts!.includes(r.contextType as ContextType));
    }

    if (options?.documentId && options.documentId.trim()) {
      results = results.filter((r) => r.chunk.documentId === options.documentId!.trim());
    }

    if (typeof options?.minScoreThreshold === 'number') {
      results = results.filter((r) => r.score >= options.minScoreThreshold!);
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    if (options?.topK && options.topK > 0) {
      results = results.slice(0, options.topK);
    }

    return results;
  }

  stageMatch(params: {
    id: string;
    documentId: string;
    content: string;
    score: number;
    context: ContextType;
    filename?: string;
    pageNumber?: number;
    chunkIndex?: number;
  }): void {
    const chunk: DocumentChunk = {
      id: params.id,
      documentId: params.documentId,
      content: params.content,
      chunkIndex: params.chunkIndex ?? 0,
      metadata: {
        documentId: params.documentId,
        context: params.context,
        filename: params.filename || 'Doc.pdf',
        pageNumber: params.pageNumber ?? 1,
        chunkIndex: params.chunkIndex ?? 0,
      },
    };

    this.stagedMatches.push({
      chunk,
      score: params.score,
      documentName: params.filename || 'Doc.pdf',
      contextType: params.context,
    });
  }

  clear(): void {
    this.queryCallCount = 0;
    this.lastQueriedVector = undefined;
    this.lastQueryOptions = undefined;
    this.shouldFail = false;
    this.failureError = undefined;
    this.stagedMatches = [];
  }
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('RagRetriever - Question & Options Validation', () => {
  let mockEmbedding: MockRetrieverEmbeddingProvider;
  let mockStorage: MockRetrieverVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockEmbedding = new MockRetrieverEmbeddingProvider();
    mockStorage = new MockRetrieverVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('validates and accepts clean non-empty question string', () => {
    const validated = retriever.validateQuestion('   What is NEC Article 690.12 rapid shutdown?   ');
    assert.equal(validated, 'What is NEC Article 690.12 rapid shutdown?');
  });

  it('rejects empty or whitespace-only questions with VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await retriever.retrieve('   ');
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('empty'));
        return true;
      }
    );
  });

  it('rejects non-string queries with VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        // @ts-expect-error Testing runtime invalid input
        await retriever.retrieve(12345);
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  it('rejects query exceeding maximum character length with VALIDATION_ERROR', async () => {
    const longQuery = 'A'.repeat(2500);

    await assert.rejects(
      async () => {
        await retriever.retrieve(longQuery);
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('exceeds'));
        return true;
      }
    );
  });

  it('rejects invalid topK (<= 0 or non-integer) with VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await retriever.retrieve('Valid query', { topK: 0 });
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('topK'));
        return true;
      }
    );

    await assert.rejects(
      async () => {
        await retriever.retrieve('Valid query', { topK: -3 });
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  it('rejects non-numeric minScoreThreshold with VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await retriever.retrieve('Valid query', { minScoreThreshold: NaN });
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('minScoreThreshold'));
        return true;
      }
    );
  });
});

describe('RagRetriever - Embedding Generation & Vector Querying', () => {
  let mockEmbedding: MockRetrieverEmbeddingProvider;
  let mockStorage: MockRetrieverVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockEmbedding = new MockRetrieverEmbeddingProvider();
    mockStorage = new MockRetrieverVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('generates query embedding with trimmed question and passes vector to storage', async () => {
    mockStorage.stageMatch({
      id: 'c1',
      documentId: 'doc_nec',
      content: 'NEC Article 690 PV rapid shutdown boundary is 1 foot.',
      score: 0.88,
      context: 'NEC',
      filename: 'NEC_690.pdf',
    });

    const result = await retriever.retrieve('  How does rapid shutdown work?  ');

    // 1. Verify embedding provider called with trimmed question
    assert.equal(mockEmbedding.callCount, 1);
    assert.equal(mockEmbedding.lastQuery, 'How does rapid shutdown work?');

    // 2. Verify storage queried with generated vector of dimensions 768
    assert.equal(mockStorage.queryCallCount, 1);
    assert.ok(mockStorage.lastQueriedVector);
    assert.equal(mockStorage.lastQueriedVector.length, EMBEDDING_DIMENSIONS);

    // 3. Verify returned payload
    assert.equal(result.query, 'How does rapid shutdown work?');
    assert.equal(result.results.length, 1);
    assert.equal(result.totalResults, 1);
    assert.equal(result.results[0].score, 0.88);
  });

  it('handles embedding provider failure without fabricating vectors', async () => {
    mockEmbedding.shouldFail = true;
    mockEmbedding.failureError = new EmbeddingError(
      'RATE_LIMIT_ERROR',
      'Google GenAI embedding rate limit: 429 Too Many Requests'
    );

    await assert.rejects(
      async () => {
        await retriever.retrieve('What is conductor derating?');
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'EMBEDDING_ERROR');
        assert.ok(err.message.includes('Google GenAI embedding rate limit'));
        return true;
      }
    );

    // Storage must NEVER be queried on embedding failure
    assert.equal(mockStorage.queryCallCount, 0);
  });

  it('throws CONFIGURATION_ERROR when embedding provider is unconfigured', async () => {
    mockEmbedding.configured = false;

    await assert.rejects(
      async () => {
        await retriever.retrieve('Any question');
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.ok(err.message.includes('GEMINI_API_KEY'));
        return true;
      }
    );
  });
});

describe('RagRetriever - Ranking & Relevance Thresholding', () => {
  let mockEmbedding: MockRetrieverEmbeddingProvider;
  let mockStorage: MockRetrieverVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockEmbedding = new MockRetrieverEmbeddingProvider();
    mockStorage = new MockRetrieverVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
      defaultTopK: 3,
      minScoreThreshold: 0.65,
    });
  });

  it('ranks results strictly by similarity score descending and applies topK', async () => {
    // Stage 4 candidates with varied scores
    mockStorage.stageMatch({ id: 'c1', documentId: 'd1', content: 'Moderate match', score: 0.72, context: 'NEC' });
    mockStorage.stageMatch({ id: 'c2', documentId: 'd1', content: 'Highest match', score: 0.94, context: 'NEC' });
    mockStorage.stageMatch({ id: 'c3', documentId: 'd1', content: 'Second highest match', score: 0.85, context: 'NEC' });
    mockStorage.stageMatch({ id: 'c4', documentId: 'd1', content: 'Above threshold match', score: 0.69, context: 'NEC' });

    const result = await retriever.retrieve('NEC question', { topK: 3 });

    // Must return top 3 in descending order of score
    assert.equal(result.results.length, 3);
    assert.equal(result.totalResults, 3);

    assert.equal(result.results[0].chunk.id, 'c2');
    assert.equal(result.results[0].score, 0.94);

    assert.equal(result.results[1].chunk.id, 'c3');
    assert.equal(result.results[1].score, 0.85);

    assert.equal(result.results[2].chunk.id, 'c1');
    assert.equal(result.results[2].score, 0.72);
  });

  it('discards chunks below the relevance threshold and returns empty when no chunks qualify', async () => {
    // Stage candidates below default 0.65 threshold
    mockStorage.stageMatch({ id: 'c1', documentId: 'd1', content: 'Low relevance text', score: 0.54, context: 'NEC' });
    mockStorage.stageMatch({ id: 'c2', documentId: 'd1', content: 'Irrelevant text', score: 0.42, context: 'NEC' });

    const result = await retriever.retrieve('Specific question', { minScoreThreshold: 0.65 });

    // Strictly returns empty results without fabricating evidence
    assert.equal(result.results.length, 0);
    assert.equal(result.totalResults, 0);
  });

  it('supports custom per-query minScoreThreshold overrides', async () => {
    mockStorage.stageMatch({ id: 'c1', documentId: 'd1', content: 'Standard match', score: 0.73, context: 'WATTMONK' });
    mockStorage.stageMatch({ id: 'c2', documentId: 'd1', content: 'High match', score: 0.88, context: 'WATTMONK' });

    // Strict threshold 0.80 should only return c2
    const strictResult = await retriever.retrieve('Plan set spec', { minScoreThreshold: 0.80 });
    assert.equal(strictResult.results.length, 1);
    assert.equal(strictResult.results[0].chunk.id, 'c2');

    // Permissive threshold 0.70 should return both
    const permissiveResult = await retriever.retrieve('Plan set spec', { minScoreThreshold: 0.70 });
    assert.equal(permissiveResult.results.length, 2);
  });
});

describe('RagRetriever - Context and Document-ID Filtering', () => {
  let mockEmbedding: MockRetrieverEmbeddingProvider;
  let mockStorage: MockRetrieverVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockEmbedding = new MockRetrieverEmbeddingProvider();
    mockStorage = new MockRetrieverVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
      minScoreThreshold: 0.50,
    });

    // Stage documents across partitioned contexts
    mockStorage.stageMatch({ id: 'nec_1', documentId: 'doc_nec', content: 'NEC 690 text', score: 0.90, context: 'NEC' });
    mockStorage.stageMatch({ id: 'wm_1', documentId: 'doc_wm_1', content: 'Wattmonk AHJ standards', score: 0.88, context: 'WATTMONK' });
    mockStorage.stageMatch({ id: 'wm_2', documentId: 'doc_wm_2', content: 'Wattmonk inverter spec', score: 0.85, context: 'WATTMONK' });
    mockStorage.stageMatch({ id: 'gen_1', documentId: 'doc_gen', content: 'General safety rules', score: 0.80, context: 'GENERAL' });
  });

  it('restricts retrieval strictly to requested context partition', async () => {
    const necOnly = await retriever.retrieve('Solar electrical rules', { contexts: ['NEC'] });
    assert.equal(necOnly.results.length, 1);
    assert.equal(necOnly.results[0].chunk.id, 'nec_1');
    assert.equal(necOnly.results[0].contextType, 'NEC');

    const wattmonkOnly = await retriever.retrieve('Solar electrical rules', { contexts: ['WATTMONK'] });
    assert.equal(wattmonkOnly.results.length, 2);
    assert.ok(wattmonkOnly.results.every((r) => r.contextType === 'WATTMONK'));
  });

  it('supports multi-context union filtering', async () => {
    const multi = await retriever.retrieve('Engineering standards', { contexts: ['NEC', 'GENERAL'] });
    assert.equal(multi.results.length, 2);
    const ids = multi.results.map((r) => r.chunk.id);
    assert.ok(ids.includes('nec_1'));
    assert.ok(ids.includes('gen_1'));
    assert.ok(!ids.includes('wm_1'));
  });

  it('restricts retrieval strictly to specific documentId when provided', async () => {
    const docFiltered = await retriever.retrieve('Wattmonk spec', {
      contexts: ['WATTMONK'],
      documentId: 'doc_wm_2',
    });

    assert.equal(docFiltered.results.length, 1);
    assert.equal(docFiltered.results[0].chunk.id, 'wm_2');
    assert.equal(docFiltered.results[0].chunk.documentId, 'doc_wm_2');
  });

  it('returns empty results when documentId does not match any staged matches', async () => {
    const emptyResult = await retriever.retrieve('Wattmonk spec', {
      documentId: 'non_existent_doc_id',
    });

    assert.equal(emptyResult.results.length, 0);
    assert.equal(emptyResult.totalResults, 0);
  });
});

describe('RagRetriever - Error Handling & Edge Cases', () => {
  let mockEmbedding: MockRetrieverEmbeddingProvider;
  let mockStorage: MockRetrieverVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockEmbedding = new MockRetrieverEmbeddingProvider();
    mockStorage = new MockRetrieverVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: mockEmbedding,
      vectorStore: mockStorage,
    });
  });

  it('returns empty result when vector store returns 0 matches (empty index)', async () => {
    // Empty store
    const result = await retriever.retrieve('Query against empty vector index');
    assert.equal(result.results.length, 0);
    assert.equal(result.totalResults, 0);
    assert.equal(result.query, 'Query against empty vector index');
  });

  it('throws CONFIGURATION_ERROR when vector store is unconfigured', async () => {
    mockStorage.configured = false;

    await assert.rejects(
      async () => {
        await retriever.retrieve('Any question');
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.ok(err.message.includes('PINECONE_API_KEY'));
        return true;
      }
    );
  });

  it('wraps vector store runtime failures in STORAGE_ERROR', async () => {
    mockStorage.shouldFail = true;
    mockStorage.failureError = new PineconeStorageError(
      'STORAGE_ERROR',
      'Pinecone index unavailable (HTTP 503)'
    );

    await assert.rejects(
      async () => {
        await retriever.retrieve('Conductor sizing question');
      },
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'STORAGE_ERROR');
        assert.ok(err.message.includes('Pinecone index unavailable'));
        return true;
      }
    );
  });

  it('safely normalizes missing or malformed chunk metadata without crashing', async () => {
    // Stage match with missing metadata fields and edge-case values
    mockStorage.stagedMatches.push({
      chunk: {
        id: 'chunk_edge_1',
        documentId: 'doc_edge',
        content: 'Valid content with sparse metadata',
        chunkIndex: 0,
        metadata: {},
      },
      score: 0.82,
      documentName: 'EdgeDoc.pdf',
    });

    const result = await retriever.retrieve('Edge case metadata query', { minScoreThreshold: 0.50 });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].chunk.content, 'Valid content with sparse metadata');
    assert.equal(result.results[0].documentName, 'EdgeDoc.pdf');
    assert.equal(result.results[0].contextType, 'GENERAL'); // Defaulted safely
  });
});

describe('RagRetriever - SourceReference Citation Mapping', () => {
  it('converts RagRetrievalResult array into standardized SourceReference citation cards', () => {
    const retriever = new RagRetriever();

    const mockResults: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_nec_690_0',
          documentId: 'doc_nec_690',
          content: 'Section 690.12 requires rapid shutdown of PV systems on buildings.',
          chunkIndex: 0,
          metadata: {
            title: 'NEC 2023 Article 690',
            filename: 'NEC_690.pdf',
            pageNumber: 42,
            context: 'NEC',
          },
        },
        score: 0.892,
        documentName: 'NEC_690.pdf',
        contextType: 'NEC',
      },
    ];

    const citations = retriever.toSourceReferences(mockResults);
    assert.equal(citations.length, 1);

    const cit = citations[0];
    assert.equal(cit.chunkId, 'chunk_nec_690_0');
    assert.equal(cit.documentId, 'doc_nec_690');
    assert.equal(cit.documentTitle, 'NEC 2023 Article 690');
    assert.equal(cit.documentName, 'NEC_690.pdf');
    assert.equal(cit.contextType, 'NEC');
    assert.equal(cit.snippet, 'Section 690.12 requires rapid shutdown of PV systems on buildings.');
    assert.equal(cit.score, 0.892);
    assert.equal(cit.pageNumber, 42);
  });
});
