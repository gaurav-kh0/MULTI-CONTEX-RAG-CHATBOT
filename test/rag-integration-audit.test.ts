/**
 * End-to-End RAG Integration Audit Test Suite
 *
 * Comprehensive integration audit verifying:
 * 1. Deterministic test documents containing known facts and verifiable answers.
 * 2. Relevant chunk retrieval and distractor filtering.
 * 3. Context routing across NEC, WATTMONK/Solar, and GENERAL.
 * 4. Explicit context selection taking strict precedence over automatic detection.
 * 5. Reality-grounded citation metadata (scores, filenames, page numbers).
 * 6. Document-only mode declining unsupported questions.
 * 7. Empty retrieval not fabricating citations.
 * 8. Multi-document synthesis across multiple retrieved chunks.
 * 9. Streaming responses preserving source citations.
 * 10. Clear distinguishability between provider errors and retrieval errors.
 * 11. Empirical Recall@k measurement on benchmark technical queries.
 */

import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RagPipeline,
  formatRetrievedEvidence,
  determineGroundingStatus,
  DECLINED_DOCUMENT_ONLY_MESSAGE,
} from '../backend/rag/rag-pipeline.ts';
import {
  RagRetriever,
  RetrieverError,
} from '../backend/rag/retriever.ts';
import {
  detectContext,
  resolveContextRouting,
} from '../backend/rag/context-detector.ts';
import {
  ProviderRegistry,
  ProviderError,
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
  LlmCompletionOptions,
  LlmCompletionResult,
  RagQueryOptions,
  RagRetrievalResult,
  SourceReference,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// 1. Deterministic Ground-Truth Corpus
// ---------------------------------------------------------------------------

interface GroundTruthFact {
  factId: string;
  documentId: string;
  filename: string;
  context: ContextType;
  pageNumber: number;
  keyClause: string;
}

const KNOWN_FACTS: Record<string, GroundTruthFact> = {
  NEC_RAPID_SHUTDOWN: {
    factId: 'fact_nec_690_12',
    documentId: 'doc_nec_audit_2023',
    filename: 'NEC_2023_Audit_Reference.pdf',
    context: 'NEC',
    pageNumber: 42,
    keyClause: '80 volts or less within 30 seconds inside array boundary',
  },
  NEC_OCPD_SIZING: {
    factId: 'fact_nec_690_8',
    documentId: 'doc_nec_audit_2023',
    filename: 'NEC_2023_Audit_Reference.pdf',
    context: 'NEC',
    pageNumber: 44,
    keyClause: '125% of maximum circuit current resulting in 156% of module Isc',
  },
  NEC_BUSBAR_120: {
    factId: 'fact_nec_705_12',
    documentId: 'doc_nec_audit_2023',
    filename: 'NEC_2023_Audit_Reference.pdf',
    context: 'NEC',
    pageNumber: 88,
    keyClause: '120 percent rule for load-side source connections on panelboard busbars',
  },
  WM_SLD_SPECS: {
    factId: 'fact_wm_sld',
    documentId: 'doc_wm_audit_standards',
    filename: 'Wattmonk_Permit_PlanSet_Standards.pdf',
    context: 'WATTMONK',
    pageNumber: 12,
    keyClause: 'THWN-2 copper conductors in EMT conduit and utility-accessible AC disconnect switch',
  },
  WM_ROOF_SETBACK: {
    factId: 'fact_wm_setback',
    documentId: 'doc_wm_audit_standards',
    filename: 'Wattmonk_Permit_PlanSet_Standards.pdf',
    context: 'WATTMONK',
    pageNumber: 18,
    keyClause: '36-inch ridge setback mandatory for residential roof slope greater than 2:12',
  },
  WM_INVERTER_RATIO: {
    factId: 'fact_wm_dc_ac',
    documentId: 'doc_wm_audit_standards',
    filename: 'Wattmonk_Permit_PlanSet_Standards.pdf',
    context: 'WATTMONK',
    pageNumber: 24,
    keyClause: 'DC/AC ratio for string inverters between 1.15 and 1.30',
  },
  GEN_OHMS_LAW: {
    factId: 'fact_gen_ohms',
    documentId: 'doc_general_audit_fundamentals',
    filename: 'General_Electrical_Fundamentals.pdf',
    context: 'GENERAL',
    pageNumber: 4,
    keyClause: 'Ohm law states V = I * R and electrical power P = V * I',
  },
  DISTRACTOR_PTO: {
    factId: 'fact_distractor_hr',
    documentId: 'doc_unrelated_hr',
    filename: 'Employee_PTO_Policy.pdf',
    context: 'GENERAL',
    pageNumber: 2,
    keyClause: 'Vacation accrual is 1.5 days per calendar month',
  },
};

function createAuditCorpusChunks(): RagRetrievalResult[] {
  return [
    {
      chunk: {
        id: 'chunk_nec_rapid_shutdown',
        documentId: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.documentId,
        content: `NEC 2023 Article 690.12 Rapid Shutdown: Controlled conductors located inside the array boundary shall be limited to ${KNOWN_FACTS.NEC_RAPID_SHUTDOWN.keyClause}. Outside boundary conductors limited to 30V within 30 seconds.`,
        chunkIndex: 0,
        metadata: {
          documentId: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.documentId,
          filename: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.filename,
          context: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.context,
          pageNumber: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.pageNumber,
          chunkIndex: 0,
          isAuthoritative: true,
        },
      },
      score: 0.91,
      documentName: KNOWN_FACTS.NEC_RAPID_SHUTDOWN.filename,
      contextType: 'NEC',
    },
    {
      chunk: {
        id: 'chunk_nec_circuit_sizing',
        documentId: KNOWN_FACTS.NEC_OCPD_SIZING.documentId,
        content: `NEC 2023 Article 690.8 Circuit Sizing: Overcurrent protection devices shall be sized at not less than ${KNOWN_FACTS.NEC_OCPD_SIZING.keyClause}. Temperature and conduit fill deratings apply per Article 310.`,
        chunkIndex: 1,
        metadata: {
          documentId: KNOWN_FACTS.NEC_OCPD_SIZING.documentId,
          filename: KNOWN_FACTS.NEC_OCPD_SIZING.filename,
          context: KNOWN_FACTS.NEC_OCPD_SIZING.context,
          pageNumber: KNOWN_FACTS.NEC_OCPD_SIZING.pageNumber,
          chunkIndex: 1,
          isAuthoritative: true,
        },
      },
      score: 0.86,
      documentName: KNOWN_FACTS.NEC_OCPD_SIZING.filename,
      contextType: 'NEC',
    },
    {
      chunk: {
        id: 'chunk_nec_busbar_120',
        documentId: KNOWN_FACTS.NEC_BUSBAR_120.documentId,
        content: `NEC 2023 Article 705.12 Point of Interconnection: Conforms to the ${KNOWN_FACTS.NEC_BUSBAR_120.keyClause}. Inverter backfed breaker must be located at the opposite end of the busbar.`,
        chunkIndex: 2,
        metadata: {
          documentId: KNOWN_FACTS.NEC_BUSBAR_120.documentId,
          filename: KNOWN_FACTS.NEC_BUSBAR_120.filename,
          context: KNOWN_FACTS.NEC_BUSBAR_120.context,
          pageNumber: KNOWN_FACTS.NEC_BUSBAR_120.pageNumber,
          chunkIndex: 2,
          isAuthoritative: true,
        },
      },
      score: 0.84,
      documentName: KNOWN_FACTS.NEC_BUSBAR_120.filename,
      contextType: 'NEC',
    },
    {
      chunk: {
        id: 'chunk_wm_sld_specs',
        documentId: KNOWN_FACTS.WM_SLD_SPECS.documentId,
        content: `Wattmonk AHJ Permit Drafting Standard 2.4: Residential Single Line Diagrams (SLD) require ${KNOWN_FACTS.WM_SLD_SPECS.keyClause}. Rapid shutdown switch must be clearly labeled.`,
        chunkIndex: 0,
        metadata: {
          documentId: KNOWN_FACTS.WM_SLD_SPECS.documentId,
          filename: KNOWN_FACTS.WM_SLD_SPECS.filename,
          context: KNOWN_FACTS.WM_SLD_SPECS.context,
          pageNumber: KNOWN_FACTS.WM_SLD_SPECS.pageNumber,
          chunkIndex: 0,
          isAuthoritative: true,
        },
      },
      score: 0.88,
      documentName: KNOWN_FACTS.WM_SLD_SPECS.filename,
      contextType: 'WATTMONK',
    },
    {
      chunk: {
        id: 'chunk_wm_roof_setback',
        documentId: KNOWN_FACTS.WM_ROOF_SETBACK.documentId,
        content: `Wattmonk Rooftop Layout Standard 3.2: Fire pathway setbacks require a ${KNOWN_FACTS.WM_ROOF_SETBACK.keyClause} to allow emergency firefighter ventilation access per IFC 1205.`,
        chunkIndex: 1,
        metadata: {
          documentId: KNOWN_FACTS.WM_ROOF_SETBACK.documentId,
          filename: KNOWN_FACTS.WM_ROOF_SETBACK.filename,
          context: KNOWN_FACTS.WM_ROOF_SETBACK.context,
          pageNumber: KNOWN_FACTS.WM_ROOF_SETBACK.pageNumber,
          chunkIndex: 1,
          isAuthoritative: true,
        },
      },
      score: 0.83,
      documentName: KNOWN_FACTS.WM_ROOF_SETBACK.filename,
      contextType: 'WATTMONK',
    },
    {
      chunk: {
        id: 'chunk_wm_inverter_ratio',
        documentId: KNOWN_FACTS.WM_INVERTER_RATIO.documentId,
        content: `Wattmonk Inverter Sizing Standard 4.1: Optimal engineering design maintains a ${KNOWN_FACTS.WM_INVERTER_RATIO.keyClause} to balance annual energy yield against inverter clipping loss.`,
        chunkIndex: 2,
        metadata: {
          documentId: KNOWN_FACTS.WM_INVERTER_RATIO.documentId,
          filename: KNOWN_FACTS.WM_INVERTER_RATIO.filename,
          context: KNOWN_FACTS.WM_INVERTER_RATIO.context,
          pageNumber: KNOWN_FACTS.WM_INVERTER_RATIO.pageNumber,
          chunkIndex: 2,
          isAuthoritative: true,
        },
      },
      score: 0.79,
      documentName: KNOWN_FACTS.WM_INVERTER_RATIO.filename,
      contextType: 'WATTMONK',
    },
    {
      chunk: {
        id: 'chunk_gen_ohms_law',
        documentId: KNOWN_FACTS.GEN_OHMS_LAW.documentId,
        content: `General Electrical Fundamentals: ${KNOWN_FACTS.GEN_OHMS_LAW.keyClause}. Kirchhoff's current law applies at every circuit junction.`,
        chunkIndex: 0,
        metadata: {
          documentId: KNOWN_FACTS.GEN_OHMS_LAW.documentId,
          filename: KNOWN_FACTS.GEN_OHMS_LAW.filename,
          context: KNOWN_FACTS.GEN_OHMS_LAW.context,
          pageNumber: KNOWN_FACTS.GEN_OHMS_LAW.pageNumber,
          chunkIndex: 0,
          isAuthoritative: true,
        },
      },
      score: 0.75,
      documentName: KNOWN_FACTS.GEN_OHMS_LAW.filename,
      contextType: 'GENERAL',
    },
    {
      chunk: {
        id: 'chunk_distractor_pto',
        documentId: KNOWN_FACTS.DISTRACTOR_PTO.documentId,
        content: `Company Internal Operations: ${KNOWN_FACTS.DISTRACTOR_PTO.keyClause}. Requests must be submitted two weeks in advance to human resources.`,
        chunkIndex: 0,
        metadata: {
          documentId: KNOWN_FACTS.DISTRACTOR_PTO.documentId,
          filename: KNOWN_FACTS.DISTRACTOR_PTO.filename,
          context: KNOWN_FACTS.DISTRACTOR_PTO.context,
          pageNumber: KNOWN_FACTS.DISTRACTOR_PTO.pageNumber,
          chunkIndex: 0,
          isAuthoritative: false,
        },
      },
      score: 0.35, // Low similarity to technical engineering questions
      documentName: KNOWN_FACTS.DISTRACTOR_PTO.filename,
      contextType: 'GENERAL',
    },
  ];
}

// ---------------------------------------------------------------------------
// 2. Audit Mock Infrastructure
// ---------------------------------------------------------------------------

class AuditMockEmbeddingProvider implements IEmbeddingProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Audit Mock Embedding Provider';
  configured = true;
  lastQuery = '';

  isConfigured(): boolean {
    return this.configured;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.embedQuery(text);
  }

  async embedQuery(query: string): Promise<number[]> {
    this.lastQuery = query;
    return new Array(768).fill(0.12);
  }

  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(768).fill(0.12));
  }
}

class AuditMockVectorStore implements IVectorStore {
  readonly isPersistent = true;
  configured = true;
  stagedMatches: RagRetrievalResult[] = [];
  embeddingProvider?: AuditMockEmbeddingProvider;

  isConfigured(): boolean {
    return this.configured;
  }

  async upsertVectors(_chunks: DocumentChunk[], _vectors: number[][]): Promise<void> {}
  async deleteByDocumentId(_documentId: string): Promise<void> {}

  async querySimilar(
    _vector: number[],
    options?: RagQueryOptions
  ): Promise<RagRetrievalResult[]> {
    let candidates = [...this.stagedMatches];

    // Partition filtering
    if (options?.contexts && options.contexts.length > 0) {
      candidates = candidates.filter((r) => options.contexts!.includes(r.contextType as ContextType));
    }

    if (options?.documentId && options.documentId.trim()) {
      candidates = candidates.filter((r) => r.chunk.documentId === options.documentId!.trim());
    }

    const STOP_WORDS = new Set([
      'what', 'is', 'the', 'for', 'next', 'and', 'are', 'per', 'with', 'from',
      'that', 'this', 'have', 'shall', 'not', 'you', 'your', 'about', 'can',
      'how', 'does', 'under', 'into', 'been', 'which', 'when', 'where', 'there',
      'here', 'any', 'all', 'some', 'than', 'year',
    ]);
    const query = this.embeddingProvider?.lastQuery?.toLowerCase() || '';
    const qTokens = query.split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    const scored: RagRetrievalResult[] = [];
    for (const item of candidates) {
      let score = item.score;
      if (qTokens.length > 0) {
        const cTokens = item.chunk.content.toLowerCase().split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
        const matchCount = qTokens.filter((t) => cTokens.includes(t)).length;
        const overlap = matchCount / qTokens.length;
        if (overlap > 0) {
          // Dynamically calculate score: 0.65 to 0.95 based on token overlap
          score = 0.65 + overlap * 0.30;
        } else {
          // Unrelated content receives low score (0.20) below default thresholds
          score = 0.20;
        }
      }

      if (typeof options?.minScoreThreshold === 'number' && score < options.minScoreThreshold) {
        continue;
      }

      scored.push({
        ...item,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    if (options?.topK && options.topK > 0) {
      return scored.slice(0, options.topK);
    }

    return scored;
  }
}

class AuditMockLlmProvider implements ILlmProviderAdapter {
  readonly id = 'mock' as const;
  readonly name = 'Audit Mock LLM Provider';
  readonly defaultModel = 'audit-mock-llm-v1';
  lastRequest?: ProviderGenerateRequest;

  isConfigured(): boolean {
    return true;
  }

  async generateText(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    this.lastRequest = request;

    // Check system prompt for retrieved evidence
    const systemPrompt = request.options?.systemPrompt || '';
    let content = 'Answer based on general engineering knowledge.';

    if (systemPrompt.includes('80 volts or less within 30 seconds')) {
      content = 'Per NEC 2023 Article 690.12, conductors inside the array boundary must be reduced to 80 volts or less within 30 seconds.';
    } else if (systemPrompt.includes('120 percent rule')) {
      content = 'According to NEC 705.12, the 120 percent rule allows load-side source connections where inverter output plus main breaker do not exceed 120% of busbar rating.';
    } else if (systemPrompt.includes('36-inch ridge setback')) {
      content = 'Wattmonk rooftop standards require a 36-inch clear ridge setback on residential roofs with slope greater than 2:12 per IFC 1205.';
    } else if (systemPrompt.includes('THWN-2 copper conductors')) {
      content = 'Wattmonk drafting guidelines mandate THWN-2 copper conductors in EMT conduit and a utility-accessible AC disconnect on the SLD.';
    } else if (systemPrompt.includes('V = I * R')) {
      content = "Ohm's law defines V = I * R and electrical power P = V * I.";
    }

    return {
      content,
      providerId: this.id,
      model: this.defaultModel,
      usage: { promptTokens: 40, completionTokens: 25, totalTokens: 65 },
    };
  }

  async *streamText(request: ProviderGenerateRequest): AsyncIterable<ProviderStreamChunk> {
    this.lastRequest = request;
    yield { text: 'Per verified document sources: ', done: false, providerId: this.id, model: this.defaultModel };
    yield { text: 'The requirement has been confirmed in the technical standards.', done: false, providerId: this.id, model: this.defaultModel };
    yield { text: '', done: true, providerId: this.id, model: this.defaultModel, usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 } };
  }

  async generateCompletion(
    prompt: string,
    options?: LlmCompletionOptions
  ): Promise<LlmCompletionResult> {
    const res = await this.generateText({ prompt, options: { model: options?.model } });
    return {
      content: res.content,
      usage: res.usage,
    };
  }
}

// ---------------------------------------------------------------------------
// 3. Test Suites
// ---------------------------------------------------------------------------

describe('RAG Integration Audit - Deterministic Fact Retrieval & Precision Filtering', () => {
  let embedding: AuditMockEmbeddingProvider;
  let vectorStore: AuditMockVectorStore;
  let retriever: RagRetriever;

  beforeEach(() => {
    embedding = new AuditMockEmbeddingProvider();
    vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
      minScoreThreshold: 0.60,
    });
  });

  it('retrieves relevant NEC rapid shutdown chunk and filters out irrelevant distractor chunks', async () => {
    const result = await retriever.retrieve('What are the voltage limits for NEC 690 rapid shutdown inside boundary?', {
      contexts: ['NEC'],
      topK: 3,
    });

    assert.ok(result.results.length >= 1);
    const topChunk = result.results[0];
    assert.equal(topChunk.chunk.id, 'chunk_nec_rapid_shutdown');
    assert.equal(topChunk.contextType, 'NEC');
    assert.match(topChunk.chunk.content, /80 volts or less within 30 seconds/i);

    // Verify distractor PTO chunk was strictly excluded
    assert.equal(result.results.some((r) => r.chunk.id === 'chunk_distractor_pto'), false);
    // Verify Wattmonk chunks excluded
    assert.equal(result.results.some((r) => r.contextType === 'WATTMONK'), false);
  });

  it('retrieves relevant Wattmonk setback chunk and filters out NEC and distractor chunks', async () => {
    const result = await retriever.retrieve('What is the required roof ridge setback for residential solar in Wattmonk plan sets?', {
      contexts: ['WATTMONK'],
      topK: 3,
    });

    assert.ok(result.results.length >= 1);
    const topChunk = result.results[0];
    assert.equal(topChunk.chunk.id, 'chunk_wm_roof_setback');
    assert.equal(topChunk.contextType, 'WATTMONK');
    assert.match(topChunk.chunk.content, /36-inch ridge setback/i);

    // Ensure zero NEC and zero distractor chunks
    assert.ok(result.results.every((r) => r.contextType === 'WATTMONK'));
  });

  it('measures 100% Recall@1 on technical benchmark test set', async () => {
    const benchmarkQueries = [
      {
        query: 'NEC 690.12 rapid shutdown conductor voltage limit',
        context: 'NEC' as ContextType,
        expectedTargetId: 'chunk_nec_rapid_shutdown',
      },
      {
        query: 'NEC 705.12 120 percent busbar interconnection rule',
        context: 'NEC' as ContextType,
        expectedTargetId: 'chunk_nec_busbar_120',
      },
      {
        query: 'Wattmonk residential SLD drafting disconnect specifications',
        context: 'WATTMONK' as ContextType,
        expectedTargetId: 'chunk_wm_sld_specs',
      },
      {
        query: 'Wattmonk roof ridge fire pathway setback requirements',
        context: 'WATTMONK' as ContextType,
        expectedTargetId: 'chunk_wm_roof_setback',
      },
      {
        query: 'Wattmonk DC/AC inverter sizing ratio for string inverters',
        context: 'WATTMONK' as ContextType,
        expectedTargetId: 'chunk_wm_inverter_ratio',
      },
      {
        query: 'Fundamental electrical formula for Ohm law and circuit power',
        context: 'GENERAL' as ContextType,
        expectedTargetId: 'chunk_gen_ohms_law',
      },
    ];

    let recallAt1Hits = 0;

    for (const item of benchmarkQueries) {
      const res = await retriever.retrieve(item.query, {
        contexts: [item.context],
        topK: 1,
      });

      if (res.results.length > 0 && res.results[0].chunk.id === item.expectedTargetId) {
        recallAt1Hits++;
      }
    }

    const recallAt1 = recallAt1Hits / benchmarkQueries.length;
    assert.equal(recallAt1, 1.0, `Expected Recall@1 to be 1.0, got ${recallAt1}`);
  });
});

describe('RAG Integration Audit - Context Routing & Explicit User Precedence', () => {
  it('correctly auto-detects obvious NEC queries without explicit context', () => {
    const routing = resolveContextRouting('What are the conductor deratings under NEC Article 310?');
    assert.deepEqual(routing.resolvedContexts, ['NEC']);
    assert.equal(routing.source, 'automatic');
    assert.equal(routing.isExplicitOverride, false);
  });

  it('correctly auto-detects obvious Wattmonk queries without explicit context', () => {
    const routing = resolveContextRouting('What is the Wattmonk SLD drafting checklist for residential solar permit sets?');
    assert.deepEqual(routing.resolvedContexts, ['WATTMONK']);
    assert.equal(routing.source, 'automatic');
    assert.equal(routing.isExplicitOverride, false);
  });

  it('correctly routes non-domain questions to safe GENERAL fallback', () => {
    const routing = resolveContextRouting('Explain how quicksort works in computer science');
    assert.deepEqual(routing.resolvedContexts, ['GENERAL']);
    assert.equal(routing.source, 'default');
  });

  it('enforces explicit user context taking strict precedence over automatic detection', () => {
    // User explicitly selects WATTMONK, but question mentions "NEC 690 rapid shutdown"
    const routing = resolveContextRouting(
      'Does NEC 690 rapid shutdown apply here?',
      ['WATTMONK']
    );

    // MUST resolve strictly to WATTMONK!
    assert.deepEqual(routing.resolvedContexts, ['WATTMONK']);
    assert.equal(routing.source, 'explicit');
    assert.equal(routing.isExplicitOverride, true);
    // Detected was NEC, but resolved is strictly WATTMONK
    assert.deepEqual(routing.detectedContexts, ['NEC']);
  });

  it('prevents accidental retrieval of NEC documents when user explicitly chose WATTMONK', async () => {
    const embedding = new AuditMockEmbeddingProvider();
    const vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    const retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
    });
    const registry = new ProviderRegistry();
    const mockLlm = new AuditMockLlmProvider();
    registry.registerProvider(mockLlm);

    const pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
    });

    // Explicit WATTMONK context, even though query is about NEC 690
    const result = await pipeline.execute({
      message: 'What are the rapid shutdown voltage limits in NEC 690?',
      contexts: ['WATTMONK'], // User explicit selection
    });

    // Resolved context must be WATTMONK
    assert.deepEqual(result.context, ['WATTMONK']);
    // No NEC chunks should be in retrievalResults or citations
    assert.ok(result.citations.every((c) => c.contextType === 'WATTMONK'));
    assert.equal(result.citations.some((c) => c.documentId === KNOWN_FACTS.NEC_RAPID_SHUTDOWN.documentId), false);
  });
});

describe('RAG Integration Audit - Source Citations & Metadata Veracity', () => {
  let embedding: AuditMockEmbeddingProvider;
  let vectorStore: AuditMockVectorStore;
  let retriever: RagRetriever;
  let registry: ProviderRegistry;
  let mockLlm: AuditMockLlmProvider;
  let pipeline: RagPipeline;

  beforeEach(() => {
    embedding = new AuditMockEmbeddingProvider();
    vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
      minScoreThreshold: 0.60,
    });
    registry = new ProviderRegistry();
    mockLlm = new AuditMockLlmProvider();
    registry.registerProvider(mockLlm);
    pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
    });
  });

  it('returns verified source citations with actual scores and accurate page numbers (never fabricated)', async () => {
    const result = await pipeline.execute({
      message: 'What is the rapid shutdown rule in NEC 690.12?',
      contexts: ['NEC'],
    });

    assert.ok(result.citations.length >= 1);
    const cit = result.citations[0];

    // Must match actual document metadata
    assert.equal(cit.documentId, KNOWN_FACTS.NEC_RAPID_SHUTDOWN.documentId);
    assert.equal(cit.filename, KNOWN_FACTS.NEC_RAPID_SHUTDOWN.filename);
    assert.equal(cit.pageNumber, KNOWN_FACTS.NEC_RAPID_SHUTDOWN.pageNumber);
    assert.ok(typeof cit.score === 'number' && cit.score >= 0.80 && cit.score <= 1.0);
    assert.match(cit.excerpt || cit.snippet || '', /80 volts or less within 30 seconds/);
  });

  it('empty retrieval does NOT fabricate citations and falls back gracefully', async () => {
    vectorStore.stagedMatches = []; // Empty store

    const result = await pipeline.execute({
      message: 'What is the color of the inverter enclosure?',
      contexts: ['GENERAL'],
      documentOnly: false,
    });

    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.references, []);
    assert.equal(result.groundingStatus, 'not_grounded');
    assert.ok(result.answer.length > 0);
  });
});

describe('RAG Integration Audit - Document-Only Mode vs General Fallback', () => {
  let embedding: AuditMockEmbeddingProvider;
  let vectorStore: AuditMockVectorStore;
  let retriever: RagRetriever;
  let registry: ProviderRegistry;
  let mockLlm: AuditMockLlmProvider;
  let pipeline: RagPipeline;

  beforeEach(() => {
    embedding = new AuditMockEmbeddingProvider();
    vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
      minScoreThreshold: 0.80, // High cutoff
    });
    registry = new ProviderRegistry();
    mockLlm = new AuditMockLlmProvider();
    registry.registerProvider(mockLlm);
    pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
    });
  });

  it('declines to answer unsupported question in document-only mode', async () => {
    const result = await pipeline.execute({
      message: 'What is the corporate holiday schedule for next year?',
      contexts: ['NEC'],
      documentOnly: true,
    });

    assert.equal(result.answer, DECLINED_DOCUMENT_ONLY_MESSAGE);
    assert.equal(result.groundingStatus, 'declined');
    assert.deepEqual(result.citations, []);
  });

  it('provides helpful general response labeled not_grounded when fallback is permitted', async () => {
    const result = await pipeline.execute({
      message: 'What is the corporate holiday schedule for next year?',
      contexts: ['GENERAL'],
      documentOnly: false,
    });

    assert.equal(result.groundingStatus, 'not_grounded');
    assert.ok(result.answer.length > 0);
    assert.notEqual(result.answer, DECLINED_DOCUMENT_ONLY_MESSAGE);
  });
});

describe('RAG Integration Audit - Multi-Document Evidence Synthesis', () => {
  let embedding: AuditMockEmbeddingProvider;
  let vectorStore: AuditMockVectorStore;
  let retriever: RagRetriever;
  let registry: ProviderRegistry;
  let mockLlm: AuditMockLlmProvider;
  let pipeline: RagPipeline;

  beforeEach(() => {
    embedding = new AuditMockEmbeddingProvider();
    vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
      minScoreThreshold: 0.60,
    });
    registry = new ProviderRegistry();
    mockLlm = new AuditMockLlmProvider();
    registry.registerProvider(mockLlm);
    pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
    });
  });

  it('synthesizes evidence from multiple distinct chunks into prompt and returns multiple citations', async () => {
    const result = await pipeline.execute({
      message: 'Explain both rapid shutdown voltage rules and OCPD circuit sizing calculations per NEC',
      contexts: ['NEC'],
      topK: 2,
    });

    // Should retrieve at least 2 distinct chunks
    assert.ok(result.citations.length >= 2);
    const chunkIds = result.citations.map((c) => c.chunkId);
    assert.ok(chunkIds.includes('chunk_nec_rapid_shutdown'));
    assert.ok(chunkIds.includes('chunk_nec_circuit_sizing'));

    // Check system prompt passed to LLM contains evidence from both chunks
    const systemPrompt = mockLlm.lastRequest?.options?.systemPrompt || '';
    assert.match(systemPrompt, /80 volts or less within 30 seconds/);
    assert.match(systemPrompt, /125% of maximum circuit current/);
  });
});

describe('RAG Integration Audit - Streaming Pipeline Source Integrity', () => {
  it('streaming response delivers progressive delta chunks and terminates with full citations', async () => {
    const embedding = new AuditMockEmbeddingProvider();
    const vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = embedding;
    vectorStore.stagedMatches = createAuditCorpusChunks();
    const retriever = new RagRetriever({
      embeddingProvider: embedding,
      vectorStore: vectorStore,
    });
    const registry = new ProviderRegistry();
    const mockLlm = new AuditMockLlmProvider();
    registry.registerProvider(mockLlm);

    const pipeline = new RagPipeline({
      retriever,
      registry,
      defaultProviderId: 'mock',
    });

    const stream = pipeline.executeStream({
      message: 'What is the residential roof setback in Wattmonk plan sets?',
      contexts: ['WATTMONK'],
    });

    const deltaChunks: string[] = [];
    let doneEvent: unknown = null;

    for await (const event of stream) {
      if (event.type === 'chunk') {
        deltaChunks.push(event.text);
      } else if (event.type === 'done') {
        doneEvent = event;
      }
    }

    assert.ok(deltaChunks.length > 0);
    assert.ok(doneEvent);
    const done = doneEvent as {
      type: 'done';
      citations: SourceReference[];
      groundingStatus: string;
      context: ContextType[];
    };
    assert.equal(done.type, 'done');
    assert.ok(done.citations.length >= 1);
    assert.equal(done.citations[0].documentId, KNOWN_FACTS.WM_ROOF_SETBACK.documentId);
    assert.equal(done.groundingStatus, 'grounded');
    assert.deepEqual(done.context, ['WATTMONK']);
  });
});

describe('RAG Integration Audit - Provider Error vs Retrieval Error Distinguishability', () => {
  it('clearly distinguishes retrieval configuration error from provider runtime error', async () => {
    const unconfiguredEmbedding = new AuditMockEmbeddingProvider();
    unconfiguredEmbedding.configured = false; // Missing GEMINI_API_KEY
    const vectorStore = new AuditMockVectorStore();
    vectorStore.embeddingProvider = unconfiguredEmbedding;
    const retriever = new RagRetriever({
      embeddingProvider: unconfiguredEmbedding,
      vectorStore,
    });

    // 1. Retrieval configuration error
    await assert.rejects(
      async () => retriever.retrieve('test query'),
      (err: unknown) => {
        assert.ok(err instanceof RetrieverError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.match(err.message, /Embedding provider is not configured/i);
        return true;
      }
    );

    // 2. Provider error has distinct class and code
    const providerErr = new ProviderError({
      providerId: 'gemini',
      code: 'RATE_LIMIT_ERROR',
      message: 'Resource has been exhausted (e.g. check quota)',
      statusCode: 429,
    });

    assert.ok(providerErr instanceof ProviderError);
    assert.equal(providerErr.code, 'RATE_LIMIT_ERROR');
    assert.notEqual(providerErr.name, 'RetrieverError');
  });
});
