/**
 * Context Detector (Server-Only RAG Routing Layer)
 *
 * Implements context-aware classification and routing for:
 * - NEC: National Electrical Code (NFPA 70, Articles 690, 705, 220, ampacity, rapid shutdown, etc.)
 * - WATTMONK: Solar PV engineering, plan sets, AHJ permitting, SLD drafting, setbacks, racking
 * - GENERAL: Safe non-domain path for general engineering, physics, and conversational queries
 *
 * Precedence Rule:
 * Explicit user-selected context MUST take complete precedence over automatic detection.
 * Automatic keyword detection only routes queries when explicit context is omitted or empty.
 */

import type { ContextType } from '../../lib/types.ts';

/**
 * Keyword definitions for National Electrical Code (NEC / NFPA 70).
 */
export const NEC_KEYWORDS_LIST: readonly string[] = [
  'nec',
  'nfpa 70',
  'article 690',
  'article 705',
  'article 706',
  'article 220',
  'article 240',
  'article 250',
  'article 310',
  'article 480',
  'article 695',
  'rapid shutdown',
  'ampacity',
  'derating',
  'temperature correction',
  'conduit fill',
  'overcurrent',
  'ocpd',
  'circuit breaker',
  'disconnect switch',
  'service entrance',
  'feeder',
  'branch circuit',
  'busbar',
  '120% rule',
  'load-side connection',
  'supply-side connection',
  'supply-side tap',
  'grounding',
  'bonding',
  'grounding electrode',
  'equipment grounding conductor',
  'egc',
  'gec',
  'arc fault',
  'afci',
  'ground fault',
  'gfdi',
  'neutral conductor',
  'voltage drop',
  'short circuit current',
  'available fault current',
] as const;

/**
 * Keyword definitions for Wattmonk / Solar PV Engineering & Permitting.
 */
export const WATTMONK_KEYWORDS_LIST: readonly string[] = [
  'wattmonk',
  'solar',
  'pv',
  'photovoltaic',
  'solar panel',
  'pv module',
  'pv array',
  'solar array',
  'string sizing',
  'string inverter',
  'microinverter',
  'power optimizer',
  'combiner box',
  'azimuth',
  'tilt angle',
  'racking',
  'ballast',
  'roof mount',
  'ground mount',
  'carport',
  'rafter spacing',
  'ahj',
  'authority having jurisdiction',
  'permit',
  'permitting',
  'plan set',
  'planset',
  'drafting',
  'single line diagram',
  'sld',
  'three line diagram',
  'site plan',
  'stringing diagram',
  'setback',
  'roof setback',
  'ridge setback',
  'fire pathway',
  'net metering',
  'nem',
  'utility interconnection',
  'shading analysis',
  'production estimate',
] as const;

/**
 * High-precision regex pattern for NEC domain keywords.
 * Uses word boundaries and optional whitespace around article numbers.
 */
const NEC_REGEX = new RegExp(
  '\\b(' +
    [
      'nec',
      'nfpa\\s*70',
      'article\\s*\\d+',
      '690\\.\\d+',
      '705\\.\\d+',
      '706\\.\\d+',
      '220\\.\\d+',
      '250\\.\\d+',
      '310\\.\\d+',
      'ampacity',
      'derating',
      'rapid\\s*shutdown',
      'overcurrent',
      'ocpd',
      'conduit\\s*fill',
      'service\\s*entrance',
      'feeder',
      'busbar(?:\\s*rating)?',
      '120%\\s*rule',
      'load[- ]side\\s*(?:connection|interconnection)',
      'supply[- ]side\\s*(?:connection|tap)',
      'grounding(?:\\s*electrode)?',
      'bonding(?:\\s*jumper)?',
      'equipment\\s*grounding\\s*conductor',
      'egc',
      'gec',
      'fault\\s*current',
      'arc\\s*fault',
      'afci',
      'gfdi',
      'circuit\\s*breaker',
      'disconnect(?:\\s*switch)?',
      'voltage\\s*drop',
    ].join('|') +
    ')\\b',
  'i'
);

/**
 * High-precision regex pattern for Wattmonk / Solar PV domain keywords.
 */
const WATTMONK_REGEX = new RegExp(
  '\\b(' +
    [
      'wattmonk',
      'solar(?:\\s*pv)?',
      'pv\\s*(?:system|module|array|string|inverter|panel|cell)',
      'photovoltaic',
      'string\\s*inverter',
      'microinverter',
      'power\\s*optimizer',
      'combiner\\s*box',
      'azimuth',
      'tilt(?:\\s*angle)?',
      'racking',
      'ballast(?:\\s*block)?',
      'roof\\s*mount',
      'ground\\s*mount',
      'carport',
      'ahj',
      'authority\\s*having\\s*jurisdiction',
      'permit(?:ting)?',
      'plan[- ]?set',
      'drafting',
      'single\\s*line\\s*diagram',
      'sld',
      'three\\s*line\\s*diagram',
      'site\\s*plan',
      'stringing\\s*diagram',
      'setback(?:\\s*clearance)?',
      'ridge\\s*setback',
      'fire\\s*pathway',
      'net\\s*metering',
      'nem',
      'utility\\s*interconnection',
      'shading(?:\\s*analysis)?',
    ].join('|') +
    ')\\b',
  'i'
);

export interface MatchedKeywords {
  nec: string[];
  wattmonk: string[];
}

/**
 * Extracts matched keywords for diagnostic auditing and telemetry.
 */
export function extractMatchedKeywords(message: string): MatchedKeywords {
  if (!message || typeof message !== 'string') {
    return { nec: [], wattmonk: [] };
  }

  const clean = message.toLowerCase();
  const necMatches: string[] = [];
  const wattmonkMatches: string[] = [];

  for (const kw of NEC_KEYWORDS_LIST) {
    if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(clean)) {
      necMatches.push(kw);
    }
  }

  for (const kw of WATTMONK_KEYWORDS_LIST) {
    if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(clean)) {
      wattmonkMatches.push(kw);
    }
  }

  return {
    nec: necMatches,
    wattmonk: wattmonkMatches,
  };
}

/**
 * Automatically classifies a user message into one or more domain context partitions.
 *
 * Rules:
 * - Obvious NEC question -> ['NEC']
 * - Obvious Wattmonk/Solar question -> ['WATTMONK']
 * - Ambiguous / multi-domain question -> ['NEC', 'WATTMONK']
 * - Non-domain-specific / safe fallback -> ['GENERAL']
 */
export function detectContext(message: string): ContextType[] {
  if (!message || typeof message !== 'string') {
    return ['GENERAL'];
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return ['GENERAL'];
  }

  const matchesNec = NEC_REGEX.test(trimmed);
  const matchesWattmonk = WATTMONK_REGEX.test(trimmed);

  if (matchesNec && matchesWattmonk) {
    return ['NEC', 'WATTMONK'];
  }
  if (matchesNec) {
    return ['NEC'];
  }
  if (matchesWattmonk) {
    return ['WATTMONK'];
  }

  return ['GENERAL'];
}

export interface ContextRoutingOptions {
  /** If true, fallback to auto-detection only when explicitContexts is omitted or empty. */
  allowAutoDetectFallback?: boolean;
}

export interface ContextRoutingResult {
  /** The final active context partition(s) to use for retrieval and prompting */
  resolvedContexts: ContextType[];
  /** Contexts detected by keyword analysis (for auditing and telemetry) */
  detectedContexts: ContextType[];
  /** Whether the user explicit selection overrode automatic detection */
  isExplicitOverride: boolean;
  /** Origin source of resolvedContexts ('explicit' | 'automatic' | 'default') */
  source: 'explicit' | 'automatic' | 'default';
  /** Matched keywords per domain */
  matchedKeywords: MatchedKeywords;
}

/**
 * Resolves context routing between explicit user selection and automatic keyword detection.
 *
 * CORE INVARIANT:
 * Explicit user-selected context MUST take complete precedence over automatic detection.
 * If the user selected ['WATTMONK'], the query is routed strictly to WATTMONK, even if
 * the query contains NEC keywords, thereby preventing accidental retrieval from unrelated domains.
 */
export function resolveContextRouting(
  query: string,
  explicitContexts?: ContextType[] | null,
  _options?: ContextRoutingOptions
): ContextRoutingResult {
  const detected = detectContext(query);
  const matched = extractMatchedKeywords(query);

  // 1. Explicit user selection takes precedence
  if (explicitContexts && Array.isArray(explicitContexts) && explicitContexts.length > 0) {
    // Deduplicate while preserving order
    const validExplicit = Array.from(new Set(explicitContexts));
    const isOverride =
      validExplicit.length !== detected.length ||
      !validExplicit.every((c) => detected.includes(c));

    return {
      resolvedContexts: validExplicit,
      detectedContexts: detected,
      isExplicitOverride: isOverride,
      source: 'explicit',
      matchedKeywords: matched,
    };
  }

  // 2. Automatic keyword-based routing
  const isDefault = detected.length === 1 && detected[0] === 'GENERAL';
  return {
    resolvedContexts: detected,
    detectedContexts: detected,
    isExplicitOverride: false,
    source: isDefault ? 'default' : 'automatic',
    matchedKeywords: matched,
  };
}

/**
 * Statutory code disclaimer to ensure electrical-code requirements are not presented as official statutory regulations.
 */
export const STATUTORY_REGULATION_DISCLAIMER =
  'Electrical code requirements and engineering standards provided herein are for technical reference and evaluation only. Official code compliance and enforcement are governed strictly by the local Authority Having Jurisdiction (AHJ) and the specific edition of NFPA 70 adopted in that jurisdiction.';
