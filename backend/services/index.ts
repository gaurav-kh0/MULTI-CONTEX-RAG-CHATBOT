import type {
  ContextScope,
  ContextType,
  CreateContextScopeRequest,
} from '../../lib/types.ts';
import { INITIAL_CONTEXT_SCOPES } from '../../lib/constants.ts';
import { documentService } from './document-service.ts';

/**
 * Service managing context scopes and metadata queries.
 */
export class ContextService {
  private scopes: Map<string, ContextScope> = new Map();

  constructor() {
    // Initialize default starter context scopes: NEC, Wattmonk/Solar, and General
    for (const scope of INITIAL_CONTEXT_SCOPES) {
      this.scopes.set(scope.id, { ...scope });
    }
  }

  async listScopes(): Promise<ContextScope[]> {
    try {
      const allDocs = await documentService.listDocuments();
      return Array.from(this.scopes.values()).map((scope) => {
        let matchingContext: ContextType | undefined;
        if (scope.id === 'scope_nec') matchingContext = 'NEC';
        else if (scope.id === 'scope_solar') matchingContext = 'WATTMONK';
        else if (scope.id === 'scope_general') matchingContext = 'GENERAL';

        const realDocIds = matchingContext
          ? allDocs
              .filter((d) => (d.metadata?.contextType || d.metadata?.context) === matchingContext)
              .map((d) => d.id)
          : scope.documentIds;

        return {
          ...scope,
          documentIds: realDocIds,
        };
      });
    } catch {
      return Array.from(this.scopes.values());
    }
  }

  async createScope(req: CreateContextScopeRequest): Promise<ContextScope> {
    const scope: ContextScope = {
      id: `scope_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: req.name,
      description: req.description,
      documentIds: [],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.scopes.set(scope.id, scope);
    return scope;
  }
}

export const defaultContextService = new ContextService();

// Authoritative central chat service re-exports
export { ChatService, chatService, chatService as defaultChatService } from './chat-service.ts';
export { documentService, DocumentService } from './document-service.ts';
export { searchService, SearchService } from './search-service.ts';
