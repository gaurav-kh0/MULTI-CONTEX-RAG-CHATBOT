import { ContextScope } from '@/lib/types';

export interface SuggestedQuestion {
  id: string;
  question: string;
  category: 'nec' | 'solar' | 'general';
  scopeId: string;
  badgeLabel: string;
}

export const INITIAL_CONTEXT_SCOPES: ContextScope[] = [
  {
    id: 'scope_nec',
    name: 'NEC (National Electrical Code)',
    description: 'NFPA 70 standards, conductor ampacity, overcurrent protection, conduit fill, and Article 690/705 rules.',
    documentIds: ['doc_nec_690', 'doc_nec_705', 'doc_nec_ampacity'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'scope_solar',
    name: 'Wattmonk / Solar PV',
    description: 'Solar PV plan set criteria, AHJ compliance standards, string inverter calculations, and rapid shutdown compliance.',
    documentIds: ['doc_wm_plansets', 'doc_wm_ahj_rules'],
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'scope_general',
    name: 'General Engineering',
    description: 'Cross-functional engineering specifications, structural setbacks, and project documentation guidelines.',
    documentIds: ['doc_general_guidelines'],
    isActive: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  {
    id: 'q1',
    question: 'What are the NEC 2023 Article 690 rapid shutdown requirements for PV systems on buildings?',
    category: 'nec',
    scopeId: 'scope_nec',
    badgeLabel: 'NEC 690',
  },
  {
    id: 'q2',
    question: 'How do I calculate 125% continuous output current for an inverter OCPD per NEC 705.12?',
    category: 'nec',
    scopeId: 'scope_nec',
    badgeLabel: 'NEC 705',
  },
  {
    id: 'q3',
    question: 'What information does Wattmonk require on the Single Line Diagram (SLD) for AHJ permit plan sets?',
    category: 'solar',
    scopeId: 'scope_solar',
    badgeLabel: 'Wattmonk / Solar',
  },
  {
    id: 'q4',
    question: 'Explain rooftop setback clearances for residential solar installations according to NFPA 1 / IFC.',
    category: 'solar',
    scopeId: 'scope_solar',
    badgeLabel: 'Wattmonk / Solar',
  },
  {
    id: 'q5',
    question: 'How are multi-context scopes combined during RAG retrieval and citation filtering?',
    category: 'general',
    scopeId: 'scope_general',
    badgeLabel: 'General',
  },
];
