import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUserMessage,
  validateContextType,
  validateContextTypes,
  validateProviderId,
  validateDocumentId,
  validateRequestSize,
  validateChatRequest,
  createApiSuccessResponse,
} from '../lib/validation.ts';
import type {
  ApiResponse,
  ChatMessage,
  UserChatMessage,
  AssistantChatMessage,
  Expect,
  Equal,
} from '../lib/types.ts';

// ---------------------------------------------------------------------------
// 1. Compile-Time Type Assertion Tests
// ---------------------------------------------------------------------------
describe('Compile-Time Type Assertions', () => {
  it('should verify discriminated union narrowing on ApiResponse', () => {
    type TestSuccess = ApiResponse<{ id: string }>;

    function checkNarrowing(res: TestSuccess) {
      if (res.success) {
        // Here res.data must be { id: string }
        const isDataPresent: Expect<Equal<typeof res.data, { id: string }>> = true;
        assert.ok(isDataPresent);
        assert.ok(res.data);
      } else {
        // Here res.error must be present
        assert.ok(res.error.code);
      }
    }

    const sampleSuccess = createApiSuccessResponse({ id: 'abc-123' });
    checkNarrowing(sampleSuccess);
  });

  it('should verify discriminated union narrowing on ChatMessage roles', () => {
    const userMsg: ChatMessage = {
      id: 'u1',
      role: 'user',
      content: 'hello',
      timestamp: new Date().toISOString(),
      contexts: ['NEC'],
    };

    if (userMsg.role === 'user') {
      const isUser: Expect<Equal<typeof userMsg, UserChatMessage>> = true;
      assert.ok(isUser);
      assert.equal(userMsg.role, 'user');
    }

    const assistantMsg: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      content: 'reply',
      timestamp: new Date().toISOString(),
      references: [],
      providerId: 'mock',
    };

    if (assistantMsg.role === 'assistant') {
      const isAssistant: Expect<Equal<typeof assistantMsg, AssistantChatMessage>> = true;
      assert.ok(isAssistant);
      assert.equal(assistantMsg.role, 'assistant');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. User Message Validation
// ---------------------------------------------------------------------------
describe('validateUserMessage', () => {
  it('accepts valid non-empty user messages', () => {
    const result = validateUserMessage('What are NEC 690 rules?');
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.value, 'What are NEC 690 rules?');
    }
  });

  it('trims leading and trailing whitespace', () => {
    const result = validateUserMessage('   Hello RAG   ');
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.value, 'Hello RAG');
    }
  });

  it('rejects empty or whitespace-only messages', () => {
    const emptyResult = validateUserMessage('');
    assert.equal(emptyResult.valid, false);

    const whitespaceResult = validateUserMessage('    ');
    assert.equal(whitespaceResult.valid, false);
    if (!whitespaceResult.valid) {
      assert.match(whitespaceResult.error, /cannot be empty/i);
    }
  });

  it('rejects non-string values', () => {
    assert.equal(validateUserMessage(12345).valid, false);
    assert.equal(validateUserMessage(null).valid, false);
    assert.equal(validateUserMessage({}).valid, false);
  });

  it('enforces maximum character length', () => {
    const longString = 'a'.repeat(4001);
    const result = validateUserMessage(longString, { maxLength: 4000 });
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /exceeds maximum allowed length/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Context Values Validation
// ---------------------------------------------------------------------------
describe('validateContextType & validateContextTypes', () => {
  it('validates canonical context types: NEC, WATTMONK, GENERAL', () => {
    assert.equal(validateContextType('NEC').valid, true);
    assert.equal(validateContextType('WATTMONK').valid, true);
    assert.equal(validateContextType('GENERAL').valid, true);
  });

  it('normalizes case and legacy scope prefixes', () => {
    const necLower = validateContextType('nec');
    assert.equal(necLower.valid, true);
    if (necLower.valid) assert.equal(necLower.value, 'NEC');

    const scopeSolar = validateContextType('scope_solar');
    assert.equal(scopeSolar.valid, true);
    if (scopeSolar.valid) assert.equal(scopeSolar.value, 'WATTMONK');
  });

  it('rejects unrecognized context values', () => {
    const result = validateContextType('INVALID_CONTEXT');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /invalid context type/i);
    }
  });

  it('validates arrays of contexts with deduplication', () => {
    const arrayResult = validateContextTypes(['NEC', 'WATTMONK', 'nec']);
    assert.equal(arrayResult.valid, true);
    if (arrayResult.valid) {
      assert.deepEqual(arrayResult.value, ['NEC', 'WATTMONK']);
    }
  });

  it('rejects non-array or empty context arrays when required', () => {
    assert.equal(validateContextTypes('NEC').valid, false);
    assert.equal(validateContextTypes([], { allowEmpty: false }).valid, false);
  });
});

// ---------------------------------------------------------------------------
// 4. Provider ID Validation
// ---------------------------------------------------------------------------
describe('validateProviderId', () => {
  it('accepts supported provider IDs', () => {
    assert.equal(validateProviderId('openai').valid, true);
    assert.equal(validateProviderId('anthropic').valid, true);
    assert.equal(validateProviderId('ollama').valid, true);
    assert.equal(validateProviderId('mock').valid, true);
  });

  it('rejects unknown provider IDs', () => {
    const result = validateProviderId('unsupported_llm');
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /invalid provider id/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Document ID Validation
// ---------------------------------------------------------------------------
describe('validateDocumentId', () => {
  it('accepts safe document identifiers', () => {
    assert.equal(validateDocumentId('doc_nec_690').valid, true);
    assert.equal(validateDocumentId('doc-solar-2023.v1').valid, true);
    assert.equal(validateDocumentId('wm:planset:001').valid, true);
  });

  it('rejects malicious or malformed document IDs', () => {
    assert.equal(validateDocumentId('../etc/passwd').valid, false);
    assert.equal(validateDocumentId('id with spaces').valid, false);
    assert.equal(validateDocumentId('a').valid, false); // Too short
  });
});

// ---------------------------------------------------------------------------
// 6. Request Size Validation
// ---------------------------------------------------------------------------
describe('validateRequestSize', () => {
  it('accepts payloads within limits', () => {
    const payload = { message: 'hello', contexts: ['NEC'] };
    const result = validateRequestSize(payload, 1024);
    assert.equal(result.valid, true);
  });

  it('rejects payloads exceeding size limits', () => {
    const largePayload = { text: 'x'.repeat(2000) };
    const result = validateRequestSize(largePayload, 500);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.match(result.error, /payload size.*exceeds maximum limit/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Composite ChatRequest Validation
// ---------------------------------------------------------------------------
describe('validateChatRequest', () => {
  it('validates a complete, well-formed ChatRequest payload', () => {
    const payload = {
      message: 'Explain 125% continuous current rule in NEC 705.12',
      contexts: ['NEC'],
      sessionId: 'sess_123',
      providerId: 'mock',
      topK: 5,
    };

    const result = validateChatRequest(payload);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.data.message, payload.message);
      assert.deepEqual(result.data.contexts, ['NEC']);
      assert.equal(result.data.sessionId, 'sess_123');
      assert.equal(result.data.providerId, 'mock');
      assert.equal(result.data.topK, 5);
    }
  });

  it('rejects requests missing a valid message', () => {
    const invalid = { message: '   ', contexts: ['NEC'] };
    const result = validateChatRequest(invalid);
    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.code, 'VALIDATION_ERROR');
    }
  });

  it('rejects non-object request payloads', () => {
    assert.equal(validateChatRequest('plain string').valid, false);
    assert.equal(validateChatRequest(null).valid, false);
    assert.equal(validateChatRequest([]).valid, false);
  });
});

// ---------------------------------------------------------------------------
// 8. Service Not-Ready State Contracts
// ---------------------------------------------------------------------------
describe('Service Readiness and Configuration Guard Contracts', () => {
  it('SearchService rejects execution with explicit CONFIGURATION_ERROR when unconfigured', async () => {
    const { searchService, SearchError } = await import('../backend/services/search-service.ts');
    await assert.rejects(
      async () => {
        await searchService.executeSearch({
          query: 'What are NEC 690 rapid shutdown rules?',
          contexts: ['NEC'],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof SearchError);
        assert.equal(err.code, 'CONFIGURATION_ERROR');
        assert.match(err.message, /Embedding provider is not configured/i);
        return true;
      }
    );
  });

  it('DocumentService returns explicit status on registration without fake parsing', async () => {
    const { documentService } = await import('../backend/services/document-service.ts');
    const result = await documentService.registerDocument({
      title: 'New Solar Standard Spec',
      contextType: 'WATTMONK',
    });

    assert.equal(result.isIndexed, false);
    assert.match(result.statusMessage, /not yet implemented/i);
    assert.equal(result.document.status, 'idle');
  });

  it('DocumentService lists seeded document metadata by context partition', async () => {
    const { documentService } = await import('../backend/services/document-service.ts');
    const necDocs = await documentService.listDocuments('NEC');
    assert.ok(necDocs.length >= 2);
    assert.ok(necDocs.every((d) => d.metadata?.contextType === 'NEC'));
  });
});
