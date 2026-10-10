/**
 * Document Service (Server-Only)
 *
 * Manages document metadata, registrations, and indexing status.
 *
 * NOTICE: PDF parsing, text extraction, and vector embedding generation
 * are not implemented yet. Unimplemented features return an explicit,
 * documented not-ready response.
 */

import type {
  ContextDocument,
  ContextType,
  DocumentResponsePayload,
  DocumentUploadRequest,
} from '../../lib/types.ts';

export class DocumentService {
  private documents: Map<string, ContextDocument> = new Map();

  constructor() {
    // Seed default document metadata records for context partitions
    const seedDocs: ContextDocument[] = [
      {
        id: 'doc_nec_690',
        name: 'NEC 2023 Article 690 - Solar Photovoltaic Systems.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 1420000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        metadata: {
          contextType: 'NEC',
          title: 'NEC 2023 Article 690 - Solar Photovoltaic Systems',
          author: 'NFPA',
        },
      },
      {
        id: 'doc_nec_705',
        name: 'NEC 2023 Article 705 - Interconnected Electric Power Production Sources.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 980000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        metadata: {
          contextType: 'NEC',
          title: 'NEC 2023 Article 705 - Interconnected Power Sources',
          author: 'NFPA',
        },
      },
      {
        id: 'doc_wm_plansets',
        name: 'Wattmonk AHJ Permit Plan Set Standards v4.2.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 2150000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 43200000).toISOString(),
        updatedAt: new Date(Date.now() - 43200000).toISOString(),
        metadata: {
          contextType: 'WATTMONK',
          title: 'Wattmonk AHJ Permit Plan Set Standards',
          author: 'Wattmonk Engineering Team',
        },
      },
      {
        id: 'doc_general_guidelines',
        name: 'General Electrical Safety & Building Code Guidelines.pdf',
        sourceType: 'file',
        status: 'idle',
        size: 512000,
        mimeType: 'application/pdf',
        tokenCount: 0,
        chunkCount: 0,
        createdAt: new Date(Date.now() - 21600000).toISOString(),
        updatedAt: new Date(Date.now() - 21600000).toISOString(),
        metadata: {
          contextType: 'GENERAL',
          title: 'General Electrical Safety & Building Code Guidelines',
        },
      },
    ];

    for (const doc of seedDocs) {
      this.documents.set(doc.id, doc);
    }
  }

  async listDocuments(contextType?: ContextType): Promise<ContextDocument[]> {
    const all = Array.from(this.documents.values());
    if (!contextType) return all;
    return all.filter((doc) => doc.metadata?.contextType === contextType);
  }

  async getDocument(id: string): Promise<ContextDocument | null> {
    return this.documents.get(id) || null;
  }

  async registerDocument(request: DocumentUploadRequest): Promise<DocumentResponsePayload> {
    const docId = `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newDoc: ContextDocument = {
      id: docId,
      name: request.title,
      sourceType: request.content ? 'text' : 'file',
      status: 'idle', // Ingestion pipeline is not implemented yet
      tokenCount: 0,
      chunkCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        contextType: request.contextType,
        title: request.title,
        author: request.author,
        sourceUrl: request.sourceUrl,
      },
    };

    this.documents.set(docId, newDoc);

    // Documented not-ready response rather than fabricated parsing success
    return {
      document: newDoc,
      isIndexed: false,
      statusMessage:
        'Document metadata registered successfully. ' +
        'PDF extraction, chunking, and vector embedding pipelines are not yet implemented in this phase.',
    };
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.documents.delete(id);
  }
}

export const documentService = new DocumentService();
