import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DocumentProcessor,
  DocumentProcessorError,
  normalizeWhitespace,
} from '../backend/rag/document-processor.ts';
import {
  TextChunker,
  textChunker,
} from '../backend/rag/chunker.ts';
import type { ExtractedPage } from '../backend/rag/document-processor.ts';

// ---------------------------------------------------------------------------
// Helpers to create valid and edge-case PDF buffers
// ---------------------------------------------------------------------------
function createMultiPagePdfBuffer(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pageRefs = pageTexts.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs}] /Count ${pageTexts.length} >>\nendobj\n`);
  pageTexts.forEach((txt, i) => {
    const pageObjNum = 3 + i * 2;
    const contentObjNum = 4 + i * 2;
    objects.push(`${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentObjNum} 0 R >>\nendobj\n`);
    const stream = `BT\n/F1 12 Tf\n50 700 Td\n(${txt}) Tj\nET\n`;
    objects.push(`${contentObjNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  });
  const body = '%PDF-1.7\n' + objects.join('');
  let xref = 'xref\n0 ' + (1 + objects.length) + '\n0000000000 65535 f \n';
  let offset = 9;
  for (const obj of objects) {
    xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    offset += obj.length;
  }
  const trailer = `trailer\n<< /Size ${1 + objects.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

function createScannedPdfBuffer(): Buffer {
  const body = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 0 >>
stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000062 00000 n 
0000000121 00000 n 
0000000185 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
235
%%EOF
`;
  return Buffer.from(body, 'latin1');
}

function createEncryptedPdfBuffer(): Buffer {
  const body = `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Filter /Standard /V 2 /R 3 /O (01234567890123456789012345678901) /U (01234567890123456789012345678901) /P -4 >>
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000062 00000 n 
0000000121 00000 n 
0000000170 00000 n 
trailer
<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>
startxref
290
%%EOF
`;
  return Buffer.from(body, 'latin1');
}

// ---------------------------------------------------------------------------
// 1. PDF Text Extraction Test Suite
// ---------------------------------------------------------------------------
describe('PDF Text Extraction - DocumentProcessor', () => {
  const processor = new DocumentProcessor();

  it('extracts text from multi-page PDF preserving page numbers', async () => {
    const pdf = createMultiPagePdfBuffer([
      'NEC Article 690 Solar Photovoltaic Systems section text.',
      'Wattmonk Engineering AHJ Plan Set Standards section text.',
      'General electrical code grounding guidelines and bonding notes.',
    ]);

    const extracted = await processor.extractText(pdf);

    assert.equal(extracted.totalPages, 3);
    assert.equal(extracted.pages.length, 3);
    assert.equal(extracted.hasText, true);

    // Verify 1-indexed page preservation
    assert.equal(extracted.pages[0].pageNumber, 1);
    assert.ok(extracted.pages[0].text.includes('NEC Article 690'));
    assert.equal(extracted.pages[1].pageNumber, 2);
    assert.ok(extracted.pages[1].text.includes('Wattmonk Engineering'));
    assert.equal(extracted.pages[2].pageNumber, 3);
    assert.ok(extracted.pages[2].text.includes('General electrical code'));
  });

  it('detects scanned PDF without extractable text and throws UNSUPPORTED_SCANNED_PDF', async () => {
    const pdf = createScannedPdfBuffer();

    await assert.rejects(
      async () => processor.extractText(pdf),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'UNSUPPORTED_SCANNED_PDF');
        assert.ok(err.message.includes('OCR is currently unavailable'));
        assert.equal(err.details?.totalPages, 1);
        assert.equal(err.details?.totalCharacters, 0);
        return true;
      }
    );
  });

  it('detects encrypted / password-protected PDF and throws ENCRYPTED_PDF', async () => {
    const pdf = createEncryptedPdfBuffer();

    await assert.rejects(
      async () => processor.extractText(pdf),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'ENCRYPTED_PDF');
        assert.ok(
          err.message.toLowerCase().includes('password') ||
          err.message.toLowerCase().includes('encrypted')
        );
        return true;
      }
    );
  });

  it('rejects malformed / corrupted PDF buffers with MALFORMED_PDF or PROCESSING_ERROR', async () => {
    const malformed = Buffer.from('%PDF-1.7\nCorrupted binary payload\n%%EOF');

    await assert.rejects(
      async () => processor.extractText(malformed),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.ok(
          err.code === 'MALFORMED_PDF' || err.code === 'PROCESSING_ERROR'
        );
        return true;
      }
    );
  });

  it('rejects empty buffer with FILE_EMPTY', async () => {
    await assert.rejects(
      async () => processor.extractText(Buffer.alloc(0)),
      (err: unknown) => {
        assert.ok(err instanceof DocumentProcessorError);
        assert.equal(err.code, 'FILE_EMPTY');
        return true;
      }
    );
  });

  it('normalizes excessive whitespace and line breaks correctly', () => {
    const messy = '  Line 1   with   spaces\r\n\r\n\r\n\r\nLine 2\t\ttabbed   \n\n\nLine 3  ';
    const cleaned = normalizeWhitespace(messy);

    assert.equal(cleaned, 'Line 1 with spaces\n\nLine 2 tabbed\n\nLine 3');
  });

  it('combines validation and text extraction via processAndExtract', async () => {
    const pdf = createMultiPagePdfBuffer(['Single page sample text.']);
    const result = await processor.processAndExtract(pdf, 'sample.pdf', 'application/pdf');

    assert.ok(result.metadata);
    assert.equal(result.metadata.sanitizedFilename, 'sample.pdf');
    assert.ok(result.metadata.sha256);
    assert.equal(result.extracted.totalPages, 1);
    assert.equal(result.extracted.pages[0].text, 'Single page sample text.');
  });
});

// ---------------------------------------------------------------------------
// 2. Text Chunker Test Suite
// ---------------------------------------------------------------------------
describe('Text Chunker - TextChunker (backend/rag/chunker.ts)', () => {
  const chunker = new TextChunker({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  it('splits long text into approximately 1000-char chunks with ~200-char overlap', () => {
    // Generate text of ~2500 characters composed of structured sentences
    const paragraph1 = 'National Electrical Code Article 690 establishes stringent safety guidelines for solar photovoltaic systems installed on residential, commercial, and industrial facilities. Conductor ampacity must be calculated according to continuous load specifications defined in Article 690.8. Overcurrent protection devices must be rated at 125 percent of the maximum circuit current.';
    const paragraph2 = 'Rapid shutdown requirements mandate that controlled conductors within the array boundary must be reduced to 80 volts or less within 30 seconds of rapid shutdown initiation. Conductors located outside the array boundary must be reduced to 30 volts or less within 30 seconds. Disconnecting means must be clearly labeled and readily accessible.';
    const paragraph3 = 'Inverter output circuits connected to the supply side of service disconnecting means per Article 705.11 require specific overcurrent protection ratings. Single line diagrams submitted to the Authority Having Jurisdiction (AHJ) must clearly demonstrate continuous current calculations, disconnect switches, and point of interconnection details.';
    const paragraph4 = 'Wattmonk engineering standards specify that all string inverter calculations must account for local ASHRAE ambient temperature extremes. High temperature derating factors directly influence conductor gauge selection and conduit fill limits according to Chapter 9 Table 1.';
    const paragraph5 = 'Ground-fault protection devices must detect ground faults in photovoltaic arrays and initiate appropriate interruption or inverter shutdown. Equipment grounding conductors must be sized in accordance with Section 250.122 based on the rating of the overcurrent device protecting the circuit conductors.';
    const paragraph6 = 'Battery storage systems integrated with photovoltaic power sources must adhere to Article 706 and NFPA 855 standards. Dedicated ventilation, thermal runaway detection, and physical barrier clearances are mandatory for indoor installations exceeding specific kilowatt-hour capacity thresholds.';
    const paragraph7 = 'Plan sets generated for utility interconnection approvals must provide exact utility point of common coupling specifications, transformer ratings, transformer secondary voltage measurements, and power factor control operating profiles.';

    const fullText = [paragraph1, paragraph2, paragraph3, paragraph4, paragraph5, paragraph6, paragraph7].join('\n\n');
    assert.ok(fullText.length > 2000, `Text length ${fullText.length} should be > 2000`);

    const chunks = chunker.chunkText(fullText, {
      documentId: 'doc_nec_690',
      filename: 'NEC_690_Overview.pdf',
      pageNumber: 1,
      context: 'NEC',
    });

    assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);

    // Verify chunk sizes are around ~1000 characters
    for (const chunk of chunks) {
      assert.ok(
        chunk.content.length <= 1100,
        `Chunk length ${chunk.content.length} should be <= 1100`
      );
      assert.ok(
        chunk.content.length >= 200,
        `Chunk length ${chunk.content.length} should be >= 200`
      );
    }

    // Verify overlap between consecutive chunks:
    // Chunk 0's trailing content should appear at the beginning of Chunk 1
    for (let i = 0; i < chunks.length - 1; i++) {
      const chunkA = chunks[i].content;
      const chunkB = chunks[i + 1].content;

      // Extract trailing ~100 characters from chunkA
      const trailingSliceA = chunkA.slice(-100).trim();
      // Check if some significant portion of trailingSliceA is present in chunkB
      const overlapWords = trailingSliceA.split(/\s+/).slice(-6).join(' ');

      assert.ok(
        chunkB.includes(overlapWords) || chunkB.includes(trailingSliceA.slice(-40)),
        `Chunk ${i + 1} should contain overlap from end of chunk ${i}.
         Chunk ${i} end: "...${trailingSliceA}"
         Chunk ${i + 1} start: "${chunkB.slice(0, 150)}..."`
      );
    }
  });

  it('prefers natural paragraph and sentence boundaries', () => {
    // Construct text where a paragraph boundary '\n\n' occurs near index 900
    const para1 = 'A'.repeat(850) + '.';
    const para2 = 'B'.repeat(850) + '.';
    const combined = `${para1}\n\n${para2}`;

    const chunks = chunker.chunkText(combined, {
      documentId: 'doc_para_test',
    });

    assert.ok(chunks.length >= 2);
    // Chunk 0 should end cleanly after the period or paragraph break
    assert.ok(
      chunks[0].content.endsWith('.') || chunks[0].content.endsWith('\n'),
      `Chunk 0 should terminate cleanly on sentence or paragraph boundary: "${chunks[0].content.slice(-20)}"`
    );
  });

  it('attaches document ID, filename, page number, context, and sequential chunk index', () => {
    const text = 'Short sample text for metadata validation.';
    const chunks = chunker.chunkText(text, {
      documentId: 'doc_wm_101',
      filename: 'Wattmonk_Permit_Standards.pdf',
      pageNumber: 4,
      context: 'WATTMONK',
      customAuthor: 'Wattmonk Engineering',
    });

    assert.equal(chunks.length, 1);
    const chunk = chunks[0];

    assert.equal(chunk.id, 'doc_wm_101_chunk_0');
    assert.equal(chunk.documentId, 'doc_wm_101');
    assert.equal(chunk.chunkIndex, 0);
    assert.equal(chunk.content, text);

    // Metadata contract assertions
    assert.equal(chunk.metadata.documentId, 'doc_wm_101');
    assert.equal(chunk.metadata.filename, 'Wattmonk_Permit_Standards.pdf');
    assert.equal(chunk.metadata.pageNumber, 4);
    assert.equal(chunk.metadata.context, 'WATTMONK');
    assert.equal(chunk.metadata.chunkIndex, 0);
    assert.equal(chunk.metadata.characterCount, text.length);
    assert.equal(chunk.metadata.customAuthor, 'Wattmonk Engineering');
  });

  it('chunks multi-page documents, skips empty pages, and preserves global chunk indices', () => {
    const pages: ExtractedPage[] = [
      {
        pageNumber: 1,
        text: 'Page 1 has valid electrical engineering content discussing NEC Article 690.',
        characterCount: 76,
      },
      {
        pageNumber: 2,
        text: '', // Empty page
        characterCount: 0,
      },
      {
        pageNumber: 3,
        text: '   \n\n\t   ', // Whitespace-only page
        characterCount: 0,
      },
      {
        pageNumber: 4,
        text: 'Page 4 has valid Wattmonk permit standards content for single line diagrams.',
        characterCount: 76,
      },
    ];

    const chunks = chunker.chunkDocumentPages(
      'doc_multipage_001',
      pages,
      {
        filename: 'Multipage_Doc.pdf',
        context: 'GENERAL',
      }
    );

    // Empty pages (2 and 3) must be skipped!
    assert.equal(chunks.length, 2);

    // Chunk 0 corresponds to Page 1
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[0].id, 'doc_multipage_001_chunk_0');
    assert.equal(chunks[0].metadata.pageNumber, 1);
    assert.ok(chunks[0].content.includes('Page 1 has valid'));

    // Chunk 1 corresponds to Page 4 (pages 2 and 3 skipped)
    assert.equal(chunks[1].chunkIndex, 1);
    assert.equal(chunks[1].id, 'doc_multipage_001_chunk_1');
    assert.equal(chunks[1].metadata.pageNumber, 4);
    assert.ok(chunks[1].content.includes('Page 4 has valid'));
  });

  it('handles boundary conditions: empty string, whitespace-only, and tiny text', () => {
    // Empty text
    assert.deepEqual(chunker.chunkText('', { documentId: 'd1' }), []);

    // Whitespace only
    assert.deepEqual(chunker.chunkText('   \n\n\t  ', { documentId: 'd1' }), []);

    // Single word under min size
    const tiny = chunker.chunkText('Hello', { documentId: 'd1' });
    assert.equal(tiny.length, 1);
    assert.equal(tiny[0].content, 'Hello');
  });

  it('handles boundary condition: unbroken text with no spaces or punctuation', () => {
    // 2500 characters of unbroken 'A' characters
    const unbroken = 'A'.repeat(2500);

    const chunks = chunker.chunkText(unbroken, { documentId: 'doc_unbroken' });

    assert.ok(chunks.length >= 2);
    // Verifies no infinite loop occurred and chunks were produced
    assert.equal(chunks[0].chunkIndex, 0);
    assert.equal(chunks[1].chunkIndex, 1);
    assert.ok(chunks[0].content.length <= 1000);
  });

  it('is completely decoupled from vector storage and embedding providers', () => {
    // TextChunker instance does not require async, network, or DB
    const syncChunker = textChunker;
    const result = syncChunker.chunkText('Decoupled RAG chunker test.', {
      documentId: 'doc_decoupled',
    });

    assert.equal(result.length, 1);
    assert.equal(typeof result[0].content, 'string');
    assert.equal(typeof result[0].chunkIndex, 'number');
  });
});
