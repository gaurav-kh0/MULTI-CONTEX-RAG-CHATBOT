import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GeminiEmbeddingProvider,
  EmbeddingError,
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  MAX_EMBEDDING_BATCH_SIZE,
  MAX_EMBEDDING_INPUT_CHARS,
} from '../backend/rag/embeddings.ts';

// Helper to generate a valid mock 768-dimensional float vector
function createMockVector(dimensions = 768, seed = 0.05): number[] {
  const vec: number[] = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) {
    vec[i] = Number(((i * 0.001 + seed) % 1).toFixed(6));
  }
  return vec;
}

describe('Embeddings - GeminiEmbeddingProvider Configuration & Model Specification', () => {
  it('reports verified model text-embedding-004 and 768 dimensions', () => {
    const provider = new GeminiEmbeddingProvider({
      apiKey: 'test-mock-key',
    });

    const info = provider.getModelInfo();
    assert.equal(info.provider, 'gemini');
    assert.equal(info.model, DEFAULT_EMBEDDING_MODEL);
    assert.equal(info.model, 'text-embedding-004');
    assert.equal(info.dimensions, EMBEDDING_DIMENSIONS);
    assert.equal(info.dimensions, 768);
    assert.equal(info.maxBatchSize, MAX_EMBEDDING_BATCH_SIZE);
    assert.equal(info.maxBatchSize, 100);
    assert.equal(info.maxInputChars, MAX_EMBEDDING_INPUT_CHARS);
  });

  it('reports configuration status accurately based on credentials', () => {
    const unconfigured = new GeminiEmbeddingProvider({
      apiKey: '',
    });
    // In absence of process.env keys:
    if (!process.env.GEMINI_API_KEY && !process.env.EMBEDDING_API_KEY) {
      assert.equal(unconfigured.isConfigured(), false);
    }

    const configured = new GeminiEmbeddingProvider({
      apiKey: 'valid-test-key',
    });
    assert.equal(configured.isConfigured(), true);
  });

  it('strictly throws CONFIGURATION_ERROR when unconfigured and never fabricates vectors', async () => {
    const unconfigured = new GeminiEmbeddingProvider({
      apiKey: undefined,
      client: null,
    });

    // Explicitly delete env vars for this test instance
    const origGemini = process.env.GEMINI_API_KEY;
    const origEmbedding = process.env.EMBEDDING_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.EMBEDDING_API_KEY;

    try {
      await assert.rejects(
        async () => unconfigured.embedQuery('What is continuous current per NEC 705?'),
        (err: unknown) => {
          assert.ok(err instanceof EmbeddingError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          assert.ok(err.message.includes('not configured'));
          return true;
        }
      );

      await assert.rejects(
        async () => unconfigured.embedDocumentChunk('Chunk text content.'),
        (err: unknown) => {
          assert.ok(err instanceof EmbeddingError);
          assert.equal(err.code, 'CONFIGURATION_ERROR');
          return true;
        }
      );
    } finally {
      if (origGemini) process.env.GEMINI_API_KEY = origGemini;
      if (origEmbedding) process.env.EMBEDDING_API_KEY = origEmbedding;
    }
  });
});

describe('Embeddings - Input & Output Validation', () => {
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-key',
  });

  it('validates input text and rejects empty or whitespace-only inputs', () => {
    assert.throws(
      () => provider.validateInput(''),
      (err: unknown) =>
        err instanceof EmbeddingError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('cannot be empty')
    );

    assert.throws(
      () => provider.validateInput('   \n\t  '),
      (err: unknown) =>
        err instanceof EmbeddingError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('cannot be empty')
    );

    assert.throws(
      () => provider.validateInput(null),
      (err: unknown) =>
        err instanceof EmbeddingError &&
        err.code === 'VALIDATION_ERROR' &&
        err.message.includes('must be a string')
    );

    assert.throws(
      () => provider.validateInput(12345),
      (err: unknown) =>
        err instanceof EmbeddingError && err.code === 'VALIDATION_ERROR'
    );
  });

  it('rejects excessively large input text exceeding max characters', () => {
    const hugeText = 'A'.repeat(MAX_EMBEDDING_INPUT_CHARS + 50);
    assert.throws(
      () => provider.validateInput(hugeText),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'VALIDATION_ERROR');
        assert.ok(err.message.includes('exceeds the maximum allowed limit'));
        return true;
      }
    );
  });

  it('validates output vector dimensions and finite numeric values', () => {
    const validVector = createMockVector(768);
    assert.doesNotThrow(() => provider.validateVector(validVector));

    // Wrong dimensions (e.g. 512 instead of 768)
    const shortVector = createMockVector(512);
    assert.throws(
      () => provider.validateVector(shortVector),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'INVALID_OUTPUT');
        assert.ok(err.message.includes('expected 768 dimensions'));
        return true;
      }
    );

    // Non-numeric or NaN values
    const nanVector = createMockVector(768);
    nanVector[10] = NaN;
    assert.throws(
      () => provider.validateVector(nanVector),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'INVALID_OUTPUT');
        assert.ok(err.message.includes('invalid non-numeric element'));
        return true;
      }
    );

    // Non-array output
    assert.throws(
      () => provider.validateVector({ notAnArray: true }),
      (err: unknown) =>
        err instanceof EmbeddingError && err.code === 'INVALID_OUTPUT'
    );
  });
});

describe('Embeddings - Query and Document Embedding (Mocked Provider Calls)', () => {
  it('embeds user search query with RETRIEVAL_QUERY taskType and verified 768 dimensions', async () => {
    let capturedParams: any = null;

    const mockClient = {
      models: {
        async embedContent(params: any) {
          capturedParams = params;
          return {
            embedding: {
              values: createMockVector(768, 0.12),
            },
          };
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const vector = await provider.embedQuery('What is Article 690.12 rapid shutdown?');

    assert.equal(capturedParams.model, 'text-embedding-004');
    assert.equal(capturedParams.contents, 'What is Article 690.12 rapid shutdown?');
    assert.equal(capturedParams.config.taskType, 'RETRIEVAL_QUERY');
    assert.equal(capturedParams.config.outputDimensionality, 768);

    assert.equal(vector.length, 768);
    assert.ok(vector.every((v) => typeof v === 'number' && Number.isFinite(v)));
  });

  it('embeds document chunk with RETRIEVAL_DOCUMENT taskType and optional title', async () => {
    let capturedParams: any = null;

    const mockClient = {
      models: {
        async embedContent(params: any) {
          capturedParams = params;
          return {
            embedding: {
              values: createMockVector(768, 0.45),
            },
          };
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const chunkContent = 'Inverters must comply with UL 1741 and IEEE 1547 interconnection standards.';
    const vector = await provider.embedDocumentChunk(chunkContent, 'NEC Article 705');

    assert.equal(capturedParams.model, 'text-embedding-004');
    assert.equal(capturedParams.contents, chunkContent);
    assert.equal(capturedParams.config.taskType, 'RETRIEVAL_DOCUMENT');
    assert.equal(capturedParams.config.title, 'NEC Article 705');
    assert.equal(vector.length, 768);
  });

  it('embeds array of document chunks in batch matching inputs order', async () => {
    let capturedParams: any = null;

    const mockClient = {
      models: {
        async embedContent(params: any) {
          capturedParams = params;
          return {
            embeddings: [
              { values: createMockVector(768, 0.1) },
              { values: createMockVector(768, 0.2) },
              { values: createMockVector(768, 0.3) },
            ],
          };
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const chunks = [
      { content: 'Chunk 1 on conductor sizing.' },
      { content: 'Chunk 2 on overcurrent protection.' },
      'Chunk 3 on disconnect switches.',
    ];

    const vectors = await provider.embedDocumentChunks(chunks);

    assert.equal(vectors.length, 3);
    assert.equal(capturedParams.contents.length, 3);
    assert.equal(capturedParams.config.taskType, 'RETRIEVAL_DOCUMENT');
    assert.equal(vectors[0].length, 768);
    assert.equal(vectors[1].length, 768);
    assert.equal(vectors[2].length, 768);
  });
});

describe('Embeddings - Batch Partitioning within Provider Limits', () => {
  it('automatically partitions batches exceeding 100 items into provider sub-batches', async () => {
    const callBatches: any[] = [];

    const mockClient = {
      models: {
        async embedContent(params: any) {
          callBatches.push(params);
          const count = params.contents.length;
          return {
            embeddings: Array.from({ length: count }, (_, i) => ({
              values: createMockVector(768, i * 0.01),
            })),
          };
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
      maxBatchSize: 100,
    });

    // Generate 150 items to force 2 sub-batches (100 + 50)
    const inputs = Array.from({ length: 150 }, (_, i) => `Technical document passage number ${i + 1}.`);

    const vectors = await provider.embedBatch(inputs, 'RETRIEVAL_DOCUMENT');

    assert.equal(vectors.length, 150);
    // Should have issued exactly 2 sub-batch requests
    assert.equal(callBatches.length, 2);
    assert.equal(callBatches[0].contents.length, 100);
    assert.equal(callBatches[1].contents.length, 50);

    // Verify all vectors are valid and 768-dimensional
    for (const vec of vectors) {
      assert.equal(vec.length, 768);
    }
  });

  it('returns empty array immediately for empty batch without network calls', async () => {
    let called = false;
    const mockClient = {
      models: {
        async embedContent() {
          called = true;
          return {};
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const res = await provider.embedBatch([]);
    assert.deepEqual(res, []);
    assert.equal(called, false);
  });
});

describe('Embeddings - Error Handling, Rate Limits & Redaction', () => {
  it('translates HTTP 429 / RESOURCE_EXHAUSTED into RATE_LIMIT_ERROR', async () => {
    const mockClient = {
      models: {
        async embedContent() {
          const err = new Error('Resource has been exhausted (e.g. check quota). [429]');
          throw err;
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    await assert.rejects(
      async () => provider.embedQuery('NEC 690 query'),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'RATE_LIMIT_ERROR');
        assert.equal(err.statusCode, 429);
        assert.ok(err.message.includes('rate limit or quota exceeded'));
        return true;
      }
    );
  });

  it('translates HTTP 401 / 403 into CONFIGURATION_ERROR and redacts API key', async () => {
    const secretKey = 'AIzaSyA_TEST_SECRET_KEY_12345';
    const mockClient = {
      models: {
        async embedContent() {
          throw new Error(`API_KEY_INVALID: Key ${secretKey} was rejected with status 401.`);
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: secretKey,
      client: mockClient,
    });

    await assert.rejects(
      async () => provider.embedQuery('Valid test query'),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.equal(err.statusCode, 401);
        // Assert secret key is NOT present anywhere in error message
        assert.ok(!err.message.includes(secretKey));
        assert.ok(err.message.includes('[REDACTED_API_KEY]'));
        return true;
      }
    );
  });

  it('translates HTTP 404 into PROVIDER_ERROR', async () => {
    const mockClient = {
      models: {
        async embedContent() {
          throw new Error('Model models/unknown-embedding-model was not found [404].');
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
      model: 'unknown-embedding-model',
    });

    await assert.rejects(
      async () => provider.embedQuery('Query text'),
      (err: unknown) => {
        assert.ok(err instanceof EmbeddingError);
        assert.equal(err.code, 'PROVIDER_ERROR');
        assert.equal(err.statusCode, 404);
        assert.ok(err.message.includes('was not found'));
        return true;
      }
    );
  });
});

describe('Embeddings - IEmbeddingProvider Interface Compatibility', () => {
  it('fulfills generateEmbedding and generateBatchEmbeddings contracts', async () => {
    const mockClient = {
      models: {
        async embedContent(params: any) {
          const isArray = Array.isArray(params.contents);
          if (isArray) {
            return {
              embeddings: params.contents.map(() => ({
                values: createMockVector(768),
              })),
            };
          }
          return {
            embedding: {
              values: createMockVector(768),
            },
          };
        },
      },
    };

    const provider = new GeminiEmbeddingProvider({
      apiKey: 'mock-key',
      client: mockClient,
    });

    const single = await provider.generateEmbedding('Sample search query');
    assert.equal(single.length, 768);

    const batch = await provider.generateBatchEmbeddings(['Passage 1', 'Passage 2']);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].length, 768);
    assert.equal(batch[1].length, 768);
  });
});
