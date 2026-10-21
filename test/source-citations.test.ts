import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RagRetriever,
} from '../backend/rag/retriever.ts';
import {
  RagPipeline,
} from '../backend/rag/rag-pipeline.ts';
import {
  ChatService,
} from '../backend/services/chat-service.ts';
import {
  ProviderRegistry,
} from '../backend/providers/index.ts';
import type {
  ILlmProviderAdapter,
  ProviderGenerateRequest,
  ProviderGenerateResult,
  ProviderStreamChunk,
} from '../backend/providers/types.ts';
import type {
  ContextType,
  DocumentChunk,
  IEmbeddingProvider,
  IVectorStore,
  RagQueryOptions,
  RagRetrievalResult,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// Mock Providers & Vector Store for Citations Testing
// ---------------------------------------------------------------------------

class MockCitationsEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Mock Citations Embedding Provider';
  configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async generateEmbedding(_text: string): Promise<number[]> {
    return new Array(768).fill(0.1);
  }

  async embedQuery(_query: string): Promise<number[]> {
    return new Array(768).fill(0.1);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(768).fill(0.1));
  }
}

class MockCitationsVectorStore implements IVectorStore {
  readonly isPersistent = true;
  stagedMatches: RagRetrievalResult[] = [];
  configured = true;

  isConfigured(): boolean {
    return this.configured;
  }

  async upsertVectors(_chunks: DocumentChunk[], _vectors: number[][]): Promise<void> {}
  async deleteByDocumentId(_documentId: string): Promise<void> {}

  async querySimilar(
    _vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
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
    title?: string;
  }): void {
    this.stagedMatches.push({
      chunk: {
        id: params.id,
        documentId: params.documentId,
        content: params.content,
        chunkIndex: 0,
        metadata: {
          documentId: params.documentId,
          context: params.context,
          filename: params.filename,
          pageNumber: params.pageNumber,
          title: params.title,
        },
      },
      score: params.score,
      documentName: params.filename || 'Doc.pdf',
      contextType: params.context,
    });
  }

  clear(): void {
    this.stagedMatches = [];
  }
}

class MockCitationsLlmProvider implements ILlmProviderAdapter {
  readonly id = 'mock' as const;
  readonly name = 'Mock Citations LLM';
  readonly defaultModel = 'mock-citations-v1';

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const userQuery = request.messages?.[request.messages.length - 1]?.content || '';
    return {
      content: `Answer to query: ${userQuery}`,
      providerId: this.id,
      model: this.defaultModel,
      usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
    };
  }

  async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    const userQuery = request.messages?.[request.messages.length - 1]?.content || '';
    yield { text: `Answer to query: ${userQuery}`, done: true, providerId: this.id, model: this.defaultModel };
  }

  async generateCompletion(prompt: string) {
    const res = await this.generateText({ prompt });
    return { content: res.content, usage: res.usage };
  }
}

// ---------------------------------------------------------------------------
// 1. Missing Metadata & Verified Metadata Integrity Tests
// ---------------------------------------------------------------------------

describe('Source Citations - Missing Metadata & Verification Integrity', () => {
  let retriever: RagRetriever;

  beforeEach(() => {
    retriever = new RagRetriever();
  });

  it('maps complete verified metadata correctly without altering values', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_full_1',
          documentId: 'doc_nec_2023',
          content: 'NEC Article 690.12 requirements for rapid shutdown.',
          chunkIndex: 0,
          metadata: {
            filename: 'NEC_2023_Complete.pdf',
            title: 'NFPA 70 2023 Edition',
            pageNumber: 142,
            context: 'NEC',
          },
        },
        score: 0.9234,
        documentName: 'NEC_2023_Complete.pdf',
        contextType: 'NEC',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 1);
    const c = citations[0];

    assert.equal(c.documentId, 'doc_nec_2023');
    assert.equal(c.chunkId, 'chunk_full_1');
    assert.equal(c.filename, 'NEC_2023_Complete.pdf');
    assert.equal(c.documentName, 'NEC_2023_Complete.pdf');
    assert.equal(c.documentTitle, 'NFPA 70 2023 Edition');
    assert.equal(c.pageNumber, 142);
    assert.equal(c.score, 0.9234);
    assert.equal(c.snippet, 'NEC Article 690.12 requirements for rapid shutdown.');
    assert.equal(c.excerpt, 'NEC Article 690.12 requirements for rapid shutdown.');
    assert.equal(c.contextType, 'NEC');
  });

  it('handles missing pageNumber without inventing a default page or crashing', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_nopage',
          documentId: 'doc_scanned',
          content: 'Plain text without page metadata.',
          chunkIndex: 0,
          metadata: {
            filename: 'ScannedDoc.pdf',
            // pageNumber omitted
          },
        },
        score: 0.81,
        documentName: 'ScannedDoc.pdf',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 1);
    // MUST NOT invent a default page like 1 or 0
    assert.equal(citations[0].pageNumber, undefined);
  });

  it('rejects invalid, negative, or non-integer page numbers without fabricating values', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_neg_page',
          documentId: 'doc_neg',
          content: 'Negative page number metadata.',
          chunkIndex: 0,
          metadata: {
            pageNumber: -5 as unknown as number,
          },
        },
        score: 0.80,
        documentName: 'Doc.pdf',
      },
      {
        chunk: {
          id: 'chunk_float_page',
          documentId: 'doc_float',
          content: 'Float page number metadata.',
          chunkIndex: 1,
          metadata: {
            pageNumber: 3.1415 as unknown as number,
          },
        },
        score: 0.79,
        documentName: 'Doc.pdf',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 2);
    assert.equal(citations[0].pageNumber, undefined);
    assert.equal(citations[1].pageNumber, undefined);
  });

  it('handles missing retrieval score without fabricating a fake score or confidence percentage', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_noscore',
          documentId: 'doc_noscore',
          content: 'Content from store that did not supply score.',
          chunkIndex: 0,
          metadata: {
            filename: 'NoScore.pdf',
          },
        },
        score: NaN as unknown as number,
        documentName: 'NoScore.pdf',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 1);
    // Score must be undefined when non-finite
    assert.equal(citations[0].score, undefined);
  });

  it('handles missing filename without inventing "Unknown Document" as a filename', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_nofilename',
          documentId: 'doc_raw_123',
          content: 'Extracted content without filename.',
          chunkIndex: 0,
          metadata: {},
        },
        score: 0.85,
        documentName: 'Unknown Document',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 1);
    assert.equal(citations[0].filename, undefined);
    assert.equal(citations[0].documentId, 'doc_raw_123');
  });

  it('handles missing or empty snippet without fabricating text', () => {
    const raw: RagRetrievalResult[] = [
      {
        chunk: {
          id: 'chunk_empty_content',
          documentId: 'doc_empty',
          content: '   ',
          chunkIndex: 0,
          metadata: {},
        },
        score: 0.75,
        documentName: 'Doc.pdf',
      },
    ];

    const citations = retriever.toSourceReferences(raw);
    assert.equal(citations.length, 1);
    assert.equal(citations[0].snippet, undefined);
    assert.equal(citations[0].excerpt, undefined);
  });
});

// ---------------------------------------------------------------------------
// 2. Multiple Sources Retrieval Tests
// ---------------------------------------------------------------------------

describe('Source Citations - Multiple Sources Handling', () => {
  let mockStore: MockCitationsVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    mockStore = new MockCitationsVectorStore();
    retriever = new RagRetriever({
      embeddingProvider: new MockCitationsEmbeddingProvider(),
      vectorStore: mockStore,
      defaultTopK: 5,
      minScoreThreshold: 0.60,
    });
  });

  it('correctly maps and preserves multiple sources ranked in descending relevance order', async () => {
    mockStore.stageMatch({
      id: 'c_mid',
      documentId: 'doc_nec',
      content: 'NEC 690.13 Inverter Disconnecting Means.',
      score: 0.82,
      context: 'NEC',
      filename: 'NEC_Disconnects.pdf',
      pageNumber: 38,
    });
    mockStore.stageMatch({
      id: 'c_highest',
      documentId: 'doc_nec',
      content: 'NEC 690.12 Rapid Shutdown of PV Systems on Buildings.',
      score: 0.94,
      context: 'NEC',
      filename: 'NEC_RapidShutdown.pdf',
      pageNumber: 42,
    });
    mockStore.stageMatch({
      id: 'c_low',
      documentId: 'doc_solar',
      content: 'Wattmonk AHJ residential solar permitting checklist.',
      score: 0.74,
      context: 'WATTMONK',
      filename: 'Wattmonk_Permit.pdf',
      pageNumber: 12,
    });

    const results = await retriever.retrieve('Solar electrical codes and permitting', {
      topK: 3,
      minScoreThreshold: 0.70,
    });

    assert.equal(results.results.length, 3);
    const citations = retriever.toSourceReferences(results.results);
    assert.equal(citations.length, 3);

    // 1st Citation: Highest score (0.94)
    assert.equal(citations[0].chunkId, 'c_highest');
    assert.equal(citations[0].score, 0.94);
    assert.equal(citations[0].pageNumber, 42);
    assert.equal(citations[0].filename, 'NEC_RapidShutdown.pdf');

    // 2nd Citation: Mid score (0.82)
    assert.equal(citations[1].chunkId, 'c_mid');
    assert.equal(citations[1].score, 0.82);
    assert.equal(citations[1].pageNumber, 38);
    assert.equal(citations[1].filename, 'NEC_Disconnects.pdf');

    // 3rd Citation: Low score (0.74)
    assert.equal(citations[2].chunkId, 'c_low');
    assert.equal(citations[2].score, 0.74);
    assert.equal(citations[2].pageNumber, 12);
    assert.equal(citations[2].filename, 'Wattmonk_Permit.pdf');
  });
});

// ---------------------------------------------------------------------------
// 3. Message-to-Source Association across Multi-Turn Conversation Tests
// ---------------------------------------------------------------------------

describe('Source Citations - Message-to-Source Association', () => {
  let mockStore: MockCitationsVectorStore;
  let chatService: ChatService;

  beforeEach(() => {
    mockStore = new MockCitationsVectorStore();
    const embedding = new MockCitationsEmbeddingProvider();
    const retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: mockStore,
      minScoreThreshold: 0.65,
    });

    const llm = new MockCitationsLlmProvider();
    const registry = new ProviderRegistry();
    registry.registerProvider(llm);

    const pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
      minScoreThreshold: 0.65,
    });

    chatService = new ChatService({
      registry,
      pipeline,
      defaultProviderId: 'mock',
    });
  });

  it('keeps citations strictly associated with the specific assistant answer across multi-turn chat', async () => {
    const session = await chatService.createSession('Multi-Turn Session');

    // TURN 1: Ask about NEC Rapid Shutdown -> Stage NEC doc
    mockStore.clear();
    mockStore.stageMatch({
      id: 'chunk_nec_turn1',
      documentId: 'doc_nec',
      content: 'NEC Article 690.12 requires rapid shutdown.',
      score: 0.92,
      context: 'NEC',
      filename: 'NEC_690.pdf',
      pageNumber: 42,
    });

    const turn1Response = await chatService.processMessage({
      sessionId: session.id,
      message: 'What is rapid shutdown per NEC 690.12?',
      contexts: ['NEC'],
    });

    // Verify Turn 1 Assistant Message citations
    assert.equal(turn1Response.assistantMessage.citations?.length, 1);
    assert.equal(turn1Response.assistantMessage.citations[0].chunkId, 'chunk_nec_turn1');
    assert.equal(turn1Response.assistantMessage.citations[0].filename, 'NEC_690.pdf');
    assert.equal(turn1Response.assistantMessage.citations[0].pageNumber, 42);

    // TURN 2: Ask about Wattmonk Permitting -> Stage Wattmonk doc
    mockStore.clear();
    mockStore.stageMatch({
      id: 'chunk_wm_turn2',
      documentId: 'doc_wattmonk',
      content: 'Wattmonk AHJ permitting checklists and requirements.',
      score: 0.88,
      context: 'WATTMONK',
      filename: 'Wattmonk_Permit_Checklist.pdf',
      pageNumber: 15,
    });

    const turn2Response = await chatService.processMessage({
      sessionId: session.id,
      message: 'What are the Wattmonk AHJ permitting requirements?',
      contexts: ['WATTMONK'],
    });

    // Verify Turn 2 Assistant Message citations
    assert.equal(turn2Response.assistantMessage.citations?.length, 1);
    assert.equal(turn2Response.assistantMessage.citations[0].chunkId, 'chunk_wm_turn2');
    assert.equal(turn2Response.assistantMessage.citations[0].filename, 'Wattmonk_Permit_Checklist.pdf');
    assert.equal(turn2Response.assistantMessage.citations[0].pageNumber, 15);

    // TURN 3: Ask a general question with NO matching documents (ungrounded fallback)
    mockStore.clear();

    const turn3Response = await chatService.processMessage({
      sessionId: session.id,
      message: 'What is the speed of light in vacuum?',
      contexts: ['GENERAL'],
      documentOnly: false,
    });

    // Verify Turn 3 Assistant Message citations: strictly empty
    assert.deepEqual(turn3Response.assistantMessage.citations, []);
    assert.deepEqual(turn3Response.references, []);
    assert.equal(turn3Response.assistantMessage.groundingStatus, 'not_grounded');

    // CRITICAL INTEGRITY CHECK: Inspect the persisted session messages
    // Turn 1 message must STILL have its original NEC citations, and Turn 2 its Wattmonk citations
    const currentSession = await chatService.getSession(session.id);
    assert.ok(currentSession);

    const assistantMessages = currentSession.messages.filter(
      (m): m is import('../lib/types.ts').AssistantChatMessage => m.role === 'assistant'
    );
    assert.equal(assistantMessages.length, 3);

    // Turn 1 message citations preserved
    assert.equal(assistantMessages[0].citations?.length, 1);
    assert.equal(assistantMessages[0].citations[0].chunkId, 'chunk_nec_turn1');
    assert.equal(assistantMessages[0].citations[0].filename, 'NEC_690.pdf');
    assert.equal(assistantMessages[0].citations[0].pageNumber, 42);

    // Turn 2 message citations preserved
    assert.equal(assistantMessages[1].citations?.length, 1);
    assert.equal(assistantMessages[1].citations[0].chunkId, 'chunk_wm_turn2');
    assert.equal(assistantMessages[1].citations[0].filename, 'Wattmonk_Permit_Checklist.pdf');
    assert.equal(assistantMessages[1].citations[0].pageNumber, 15);

    // Turn 3 message citations preserved as empty
    assert.deepEqual(assistantMessages[2].citations, []);
  });
});
