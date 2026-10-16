/**
 * Curated Knowledge (Server-Only Built-In Sample Repository)
 *
 * Provides curated reference material for:
 * - NEC: NFPA 70 Articles 690 (Solar PV) and 705 (Interconnection)
 * - WATTMONK: Solar PV AHJ permit plan set guidelines and rooftop setbacks
 * - GENERAL: Electrical safety fundamentals (Ohm's Law, PPE, NFPA 70E)
 *
 * Authority & Provenance Integrity:
 * - All built-in sample content is explicitly tagged with `isBuiltInSample: true`,
 *   `isAuthoritative: false`, and `provenance: 'built-in-sample'`.
 * - Clearly distinguishes built-in sample content from authoritative uploaded documents.
 * - Prevents presenting fabricated electrical-code requirements as official regulations.
 */

import type { ContextType, DocumentChunk, IVectorStore } from '../../lib/types.ts';

export interface CuratedDocumentMetadata {
  context: ContextType;
  contextType: ContextType;
  documentId: string;
  filename: string;
  title: string;
  author: string;
  pageNumber?: number;
  chunkIndex: number;
  isBuiltInSample: true;
  isAuthoritative: false;
  provenance: 'built-in-sample';
  disclaimer: string;
  [key: string]: unknown;
}

export interface CuratedDocument {
  id: string;
  name: string;
  contextType: ContextType;
  title: string;
  author: string;
  description: string;
  isBuiltInSample: true;
  isAuthoritative: false;
  provenance: 'built-in-sample';
  disclaimer: string;
  chunks: DocumentChunk[];
}

export const SAMPLE_DISCLAIMER_NOTICE =
  'Curated built-in technical reference sample. Not an official statutory copy of NFPA 70 or proprietary AHJ standard. For official compliance, consult the adopted code edition from the local AHJ.';

export const CURATED_DOCUMENTS: readonly CuratedDocument[] = [
  {
    id: 'doc_nec_690',
    name: 'NEC 2023 Article 690 - Solar Photovoltaic Systems.pdf',
    contextType: 'NEC',
    title: 'NEC 2023 Article 690 - Solar Photovoltaic Systems',
    author: 'NFPA (Curated Reference Excerpt)',
    description: 'National Electrical Code rules governing solar PV system circuit sizing, disconnects, and rapid shutdown.',
    isBuiltInSample: true,
    isAuthoritative: false,
    provenance: 'built-in-sample',
    disclaimer: SAMPLE_DISCLAIMER_NOTICE,
    chunks: [
      {
        id: 'doc_nec_690_chunk_0',
        documentId: 'doc_nec_690',
        content:
          'NEC 2023 Article 690.12 - Rapid Shutdown of PV Systems on Buildings.\n' +
          'PV system circuits installed on or in buildings shall include a rapid shutdown function to reduce shock hazard for emergency responders.\n' +
          '1. Inside the Array Boundary: Controlled conductors inside the boundary (defined as within 1 foot / 305 mm of the array in all directions) shall be limited to 80 volts or less within 30 seconds of rapid shutdown initiation.\n' +
          '2. Outside the Array Boundary: Controlled conductors outside the array boundary (greater than 1 foot from array or entering a building) shall be limited to 30 volts or less within 30 seconds of initiation.\n' +
          '3. Initiation Device: The rapid shutdown initiation device must consist of a readily accessible switch located on the exterior of the building or a clearly identified service disconnect switch labeled per Article 690.56(C).',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_nec_690',
          filename: 'NEC_2023_Article_690.pdf',
          title: 'NEC 2023 Article 690 - Solar Photovoltaic Systems',
          author: 'NFPA (Curated Reference Excerpt)',
          context: 'NEC',
          contextType: 'NEC',
          pageNumber: 42,
          chunkIndex: 0,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
      {
        id: 'doc_nec_690_chunk_1',
        documentId: 'doc_nec_690',
        content:
          'NEC 2023 Article 690.8 - Circuit Sizing and Current Calculations.\n' +
          '1. Maximum PV System Circuit Current: Shall be calculated as the sum of parallel module rated short-circuit currents (Isc) multiplied by 125 percent to account for elevated solar irradiance conditions (edge-of-cloud effect and reflective snow).\n' +
          '2. Overcurrent Protection Device (OCPD) Sizing: Overcurrent devices protecting PV output and source circuits shall be sized not less than 125 percent of the maximum circuit current, resulting in a minimum continuous design factor of 156 percent of rated module Isc.\n' +
          '3. Conductor Ampacity: Conductors must be copper or aluminum with insulation ratings (e.g. USE-2, PV Wire, or THWN-2) derated for ambient roof temperature and conduit fill per NEC Article 310.',
        chunkIndex: 1,
        metadata: {
          documentId: 'doc_nec_690',
          filename: 'NEC_2023_Article_690.pdf',
          title: 'NEC 2023 Article 690 - Solar Photovoltaic Systems',
          author: 'NFPA (Curated Reference Excerpt)',
          context: 'NEC',
          contextType: 'NEC',
          pageNumber: 44,
          chunkIndex: 1,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
    ],
  },
  {
    id: 'doc_nec_705',
    name: 'NEC 2023 Article 705 - Interconnected Electric Power Production Sources.pdf',
    contextType: 'NEC',
    title: 'NEC 2023 Article 705 - Interconnected Power Sources',
    author: 'NFPA (Curated Reference Excerpt)',
    description: 'National Electrical Code rules governing utility interconnection, busbar sizing, and 120% rule.',
    isBuiltInSample: true,
    isAuthoritative: false,
    provenance: 'built-in-sample',
    disclaimer: SAMPLE_DISCLAIMER_NOTICE,
    chunks: [
      {
        id: 'doc_nec_705_chunk_0',
        documentId: 'doc_nec_705',
        content:
          'NEC 2023 Article 705.12 - Point of Interconnection (Load-Side Source Connections).\n' +
          'Where a solar inverter or interconnected power production source connects to a panelboard on the load side of the main service disconnect, the 120 percent rule applies per 705.12(B).\n' +
          '1. Busbar Ampacity Calculation: The sum of 125 percent of the inverter continuous output current rating plus the main utility overcurrent device rating shall not exceed 120 percent of the panelboard busbar ampacity rating.\n' +
          '2. Breaker Placement: The inverter backfed circuit breaker must be located at the opposite end of the busbar from the utility input connection to avoid localized busbar overheating.\n' +
          '3. Warning Label: A permanent warning label must be applied adjacent to the backfed breaker stating: WARNING: INVERTER OUTPUT CONNECTION; DO NOT RELOCATE THIS OVERCURRENT DEVICE.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_nec_705',
          filename: 'NEC_2023_Article_705.pdf',
          title: 'NEC 2023 Article 705 - Interconnected Power Sources',
          author: 'NFPA (Curated Reference Excerpt)',
          context: 'NEC',
          contextType: 'NEC',
          pageNumber: 15,
          chunkIndex: 0,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
    ],
  },
  {
    id: 'doc_wm_plansets',
    name: 'Wattmonk AHJ Permit Plan Set Standards v4.2.pdf',
    contextType: 'WATTMONK',
    title: 'Wattmonk AHJ Permit Plan Set Standards',
    author: 'Wattmonk Engineering Team',
    description: 'Engineering drafting standards for residential solar permit plan sets, SLD requirements, and rooftop setbacks.',
    isBuiltInSample: true,
    isAuthoritative: false,
    provenance: 'built-in-sample',
    disclaimer: SAMPLE_DISCLAIMER_NOTICE,
    chunks: [
      {
        id: 'doc_wm_plansets_chunk_0',
        documentId: 'doc_wm_plansets',
        content:
          'Wattmonk AHJ Permit Plan Set Standards v4.2 - Section 2: Electrical Single Line Diagram (SLD) Requirements.\n' +
          'All permit plan sets prepared by Wattmonk must feature a dedicated Single Line Diagram (SLD) page displaying:\n' +
          '1. PV module manufacturer, model, and series string configuration (e.g., 2 strings of 10 modules).\n' +
          '2. Inverter make, model, continuous AC output power, and DC input operating voltage range.\n' +
          '3. Rapid shutdown initiation switch location and exterior label designation.\n' +
          '4. AC utility disconnect switch rating, fuse size if applicable, and physical location.\n' +
          '5. Point of interconnection specifying service panel busbar rating, main breaker rating, and PV backfed breaker rating.\n' +
          '6. Conductor types (e.g. #10 AWG Copper THWN-2), conduit schedule, and equipment grounding conductor (EGC) sizing.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_wm_plansets',
          filename: 'Wattmonk_AHJ_Permit_Plan_Set_Standards.pdf',
          title: 'Wattmonk AHJ Permit Plan Set Standards',
          author: 'Wattmonk Engineering Team',
          context: 'WATTMONK',
          contextType: 'WATTMONK',
          pageNumber: 8,
          chunkIndex: 0,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
      {
        id: 'doc_wm_plansets_chunk_1',
        documentId: 'doc_wm_plansets',
        content:
          'Wattmonk Rooftop Layout & Structural Setback Guidelines Section 3.4.\n' +
          'Residential solar roof attachments must maintain required fire service pathways per International Fire Code (IFC) Section 1205.\n' +
          '1. Ridge Setbacks: For hip and gable roof designs, a minimum 36-inch clear setback from the roof ridge is mandatory on all roof planes containing PV modules.\n' +
          '2. Valleys and Hips: Pathways across roof hips and valleys must provide at least one 36-inch clear access aisle extending from the eaves to the ridge.\n' +
          '3. Structural Data: Array layout plans must specify module tilt, azimuth orientation, attachment spacing relative to rafters, and maximum allowable design wind and snow loads.',
        chunkIndex: 1,
        metadata: {
          documentId: 'doc_wm_plansets',
          filename: 'Wattmonk_AHJ_Permit_Plan_Set_Standards.pdf',
          title: 'Wattmonk AHJ Permit Plan Set Standards',
          author: 'Wattmonk Engineering Team',
          context: 'WATTMONK',
          contextType: 'WATTMONK',
          pageNumber: 14,
          chunkIndex: 1,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
    ],
  },
  {
    id: 'doc_general_guidelines',
    name: 'General Electrical Safety & Building Code Guidelines.pdf',
    contextType: 'GENERAL',
    title: 'General Electrical Safety & Building Code Guidelines',
    author: 'Engineering Standards Institute',
    description: 'Fundamental electrical principles, Ohm’s Law, PPE guidelines, and general circuit calculations.',
    isBuiltInSample: true,
    isAuthoritative: false,
    provenance: 'built-in-sample',
    disclaimer: SAMPLE_DISCLAIMER_NOTICE,
    chunks: [
      {
        id: 'doc_general_guidelines_chunk_0',
        documentId: 'doc_general_guidelines',
        content:
          'General Electrical Safety & Engineering Principles.\n' +
          '1. Fundamental Circuit Formulas: Ohm\'s law states that Voltage (V) equals Current (I) multiplied by Resistance (R) [V = I * R]. Electrical power in watts equals Voltage multiplied by Current [P = V * I]. In AC circuits, apparent power (VA) differs from real power (Watts) by the circuit power factor.\n' +
          '2. NFPA 70E Safety Compliance: Working on or near energized conductors requires appropriate Personal Protective Equipment (PPE), arc flash boundary evaluation, and Lockout/Tagout (LOTO) protocols prior to servicing electrical installations.\n' +
          '3. Commissioning: Pre-energization insulation resistance testing must be conducted with a calibrated megohmmeter to ensure wire insulation integrity.',
        chunkIndex: 0,
        metadata: {
          documentId: 'doc_general_guidelines',
          filename: 'General_Electrical_Safety_Guidelines.pdf',
          title: 'General Electrical Safety & Building Code Guidelines',
          author: 'Engineering Standards Institute',
          context: 'GENERAL',
          contextType: 'GENERAL',
          pageNumber: 5,
          chunkIndex: 0,
          isBuiltInSample: true,
          isAuthoritative: false,
          provenance: 'built-in-sample',
          disclaimer: SAMPLE_DISCLAIMER_NOTICE,
        },
      },
    ],
  },
];

/**
 * Returns all built-in curated sample documents.
 */
export function getCuratedDocuments(): readonly CuratedDocument[] {
  return CURATED_DOCUMENTS;
}

/**
 * Returns all curated chunks, optionally filtered by context partition(s).
 */
export function getCuratedChunks(contexts?: ContextType[]): DocumentChunk[] {
  const allChunks: DocumentChunk[] = [];
  for (const doc of CURATED_DOCUMENTS) {
    if (!contexts || contexts.length === 0 || contexts.includes(doc.contextType)) {
      allChunks.push(...doc.chunks);
    }
  }
  return allChunks;
}

/**
 * Checks whether a document ID corresponds to a built-in curated sample document.
 */
export function isSampleDocument(documentId: string): boolean {
  return CURATED_DOCUMENTS.some((d) => d.id === documentId);
}

/**
 * Seeds curated chunks into a vector store instance (such as InMemoryVectorStore).
 * Assigns deterministic unit vectors so similarity queries succeed predictably without external API dependencies.
 */
export async function seedCuratedKnowledgeToVectorStore(vectorStore: IVectorStore): Promise<number> {
  const chunks = getCuratedChunks();
  if (chunks.length === 0) return 0;

  // Generate deterministic normalized unit vectors for in-memory retrieval
  const vectors: number[][] = chunks.map((_, i) => {
    const v = new Array(768).fill(0.01);
    v[i % 768] = 0.99;
    return v;
  });

  await vectorStore.upsertVectors(chunks, vectors);
  return chunks.length;
}
