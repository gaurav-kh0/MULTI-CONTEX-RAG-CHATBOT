import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectContext,
  extractMatchedKeywords,
  resolveContextRouting,
  NEC_KEYWORDS_LIST,
  WATTMONK_KEYWORDS_LIST,
  STATUTORY_REGULATION_DISCLAIMER,
} from '../backend/rag/context-detector.ts';

describe('Context Detection - Keyword Dictionaries & Constants', () => {
  it('exposes comprehensive NEC keyword definitions', () => {
    assert.ok(Array.isArray(NEC_KEYWORDS_LIST));
    assert.ok(NEC_KEYWORDS_LIST.length >= 25);
    assert.ok(NEC_KEYWORDS_LIST.includes('nec'));
    assert.ok(NEC_KEYWORDS_LIST.includes('nfpa 70'));
    assert.ok(NEC_KEYWORDS_LIST.includes('article 690'));
    assert.ok(NEC_KEYWORDS_LIST.includes('article 705'));
    assert.ok(NEC_KEYWORDS_LIST.includes('rapid shutdown'));
    assert.ok(NEC_KEYWORDS_LIST.includes('ampacity'));
    assert.ok(NEC_KEYWORDS_LIST.includes('120% rule'));
    assert.ok(NEC_KEYWORDS_LIST.includes('supply-side tap'));
  });

  it('exposes comprehensive Wattmonk / Solar keyword definitions', () => {
    assert.ok(Array.isArray(WATTMONK_KEYWORDS_LIST));
    assert.ok(WATTMONK_KEYWORDS_LIST.length >= 25);
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('wattmonk'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('solar'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('pv'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('microinverter'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('string inverter'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('single line diagram'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('sld'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('ahj'));
    assert.ok(WATTMONK_KEYWORDS_LIST.includes('fire pathway'));
  });

  it('provides statutory regulation disclaimer mentioning AHJ and NFPA 70', () => {
    assert.ok(typeof STATUTORY_REGULATION_DISCLAIMER === 'string');
    assert.ok(STATUTORY_REGULATION_DISCLAIMER.includes('Authority Having Jurisdiction (AHJ)'));
    assert.ok(STATUTORY_REGULATION_DISCLAIMER.includes('NFPA 70'));
  });
});

describe('Context Detection - detectContext Heuristics', () => {
  it('correctly classifies National Electrical Code (NEC) queries', () => {
    const necQueries = [
      'What are the rapid shutdown requirements in NEC Article 690.12?',
      'How to calculate conductor ampacity derating per NFPA 70 Table 310.16?',
      'What is the 120% busbar rule in NEC Article 705.12?',
      'Where is a supply-side connection allowed?',
      'Explain grounding electrode conductor sizing per article 250.',
      'What conduit fill percentage applies for 4 THHN conductors?',
      'What are the requirements for an ocpd circuit breaker disconnect switch?',
    ];

    for (const query of necQueries) {
      const detected = detectContext(query);
      assert.deepEqual(detected, ['NEC'], `Expected ['NEC'] for query: "${query}"`);
    }
  });

  it('correctly classifies Wattmonk / Solar PV engineering queries', () => {
    const solarQueries = [
      'What is Wattmonk standard procedure for residential plan sets?',
      'How do I specify azimuth and tilt angle for rooftop racking?',
      'What information must be included in a solar single line diagram (SLD)?',
      'What are the AHJ permitting requirements for rooftop solar PV systems?',
      'How do fire pathway roof setbacks affect PV module placement?',
      'Explain string inverter vs microinverter configuration on site plan drafting.',
      'What ballast block weight is needed for flat roof racking?',
    ];

    for (const query of solarQueries) {
      const detected = detectContext(query);
      assert.deepEqual(detected, ['WATTMONK'], `Expected ['WATTMONK'] for query: "${query}"`);
    }
  });

  it('correctly classifies cross-domain queries matching both domains as [NEC, WATTMONK]', () => {
    const crossQueries = [
      'How do I size a solar PV string inverter disconnect per NEC 690?',
      'Does the AHJ require rapid shutdown labels on the solar single line diagram per NEC Article 690.12?',
      'How does the 120% rule in NEC 705 apply to Wattmonk solar interconnection drafting?',
    ];

    for (const query of crossQueries) {
      const detected = detectContext(query);
      assert.deepEqual(
        detected,
        ['NEC', 'WATTMONK'],
        `Expected ['NEC', 'WATTMONK'] for cross query: "${query}"`
      );
    }
  });

  it('falls back to GENERAL for conversational or non-domain queries', () => {
    const generalQueries = [
      'Hello, what can you do?',
      'What is the speed of light in vacuum?',
      'Can you explain Newton’s second law of motion?',
      'Write a python script to reverse a linked list.',
      'Who was Nikola Tesla?',
    ];

    for (const query of generalQueries) {
      const detected = detectContext(query);
      assert.deepEqual(detected, ['GENERAL'], `Expected ['GENERAL'] for query: "${query}"`);
    }
  });

  it('handles empty, whitespace, and non-string inputs safely with GENERAL fallback', () => {
    assert.deepEqual(detectContext(''), ['GENERAL']);
    assert.deepEqual(detectContext('   \t\n  '), ['GENERAL']);
    assert.deepEqual(detectContext(null as unknown as string), ['GENERAL']);
    assert.deepEqual(detectContext(undefined as unknown as string), ['GENERAL']);
    assert.deepEqual(detectContext(12345 as unknown as string), ['GENERAL']);
  });
});

describe('Context Detection - extractMatchedKeywords Diagnostics', () => {
  it('extracts matched keywords accurately for diagnostic auditing', () => {
    const matches = extractMatchedKeywords(
      'We need to verify rapid shutdown per NEC Article 690 and check solar array azimuth on Wattmonk plan set.'
    );

    assert.ok(matches.nec.includes('rapid shutdown'));
    assert.ok(matches.nec.includes('nec'));
    assert.ok(matches.nec.includes('article 690'));

    assert.ok(matches.wattmonk.includes('solar'));
    assert.ok(matches.wattmonk.includes('solar array'));
    assert.ok(matches.wattmonk.includes('azimuth'));
    assert.ok(matches.wattmonk.includes('wattmonk'));
    assert.ok(matches.wattmonk.includes('plan set'));
  });

  it('returns empty lists for queries with no domain keywords', () => {
    const matches = extractMatchedKeywords('What is the capital of France?');
    assert.deepEqual(matches, { nec: [], wattmonk: [] });
  });

  it('handles non-string or empty inputs without throwing', () => {
    assert.deepEqual(extractMatchedKeywords(''), { nec: [], wattmonk: [] });
    assert.deepEqual(extractMatchedKeywords(null as unknown as string), { nec: [], wattmonk: [] });
  });
});

describe('Context Detection - resolveContextRouting Precedence Invariant', () => {
  it('guarantees explicit user selection completely overrides automatic detection', () => {
    // Query contains NEC keywords, but user explicitly selected WATTMONK
    const routingResult = resolveContextRouting(
      'What are the rapid shutdown rules in NEC Article 690.12?',
      ['WATTMONK']
    );

    assert.deepEqual(routingResult.resolvedContexts, ['WATTMONK']);
    assert.deepEqual(routingResult.detectedContexts, ['NEC']);
    assert.equal(routingResult.isExplicitOverride, true);
    assert.equal(routingResult.source, 'explicit');
  });

  it('guarantees explicit GENERAL selection overrides domain keywords', () => {
    // Query contains solar and NEC keywords, but user explicitly selected GENERAL
    const routingResult = resolveContextRouting(
      'How to wire solar string inverter per NEC 690?',
      ['GENERAL']
    );

    assert.deepEqual(routingResult.resolvedContexts, ['GENERAL']);
    assert.deepEqual(routingResult.detectedContexts, ['NEC', 'WATTMONK']);
    assert.equal(routingResult.isExplicitOverride, true);
    assert.equal(routingResult.source, 'explicit');
  });

  it('deduplicates explicit context array while preserving ordering', () => {
    const routingResult = resolveContextRouting('Hello', [
      'NEC',
      'WATTMONK',
      'NEC',
      'WATTMONK',
    ]);

    assert.deepEqual(routingResult.resolvedContexts, ['NEC', 'WATTMONK']);
    assert.equal(routingResult.source, 'explicit');
  });

  it('falls back to automatic routing when explicitContexts is omitted or empty', () => {
    // Omitted
    const autoResult = resolveContextRouting('Explain rooftop solar tilt angle');
    assert.deepEqual(autoResult.resolvedContexts, ['WATTMONK']);
    assert.equal(autoResult.isExplicitOverride, false);
    assert.equal(autoResult.source, 'automatic');

    // Empty array
    const emptyResult = resolveContextRouting('Explain ampacity derating per NEC 310', []);
    assert.deepEqual(emptyResult.resolvedContexts, ['NEC']);
    assert.equal(emptyResult.isExplicitOverride, false);
    assert.equal(emptyResult.source, 'automatic');

    // General fallback
    const generalResult = resolveContextRouting('What is today’s weather?', null);
    assert.deepEqual(generalResult.resolvedContexts, ['GENERAL']);
    assert.equal(generalResult.isExplicitOverride, false);
    assert.equal(generalResult.source, 'default');
  });
});
