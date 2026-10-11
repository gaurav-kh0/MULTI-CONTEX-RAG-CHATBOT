# Multi-Context RAG Chatbot

A high-performance, strictly typed multi-context engineering assistant built with Next.js 14 App Router, React 18, TypeScript (strict mode), and Tailwind CSS.

The application partitions queries across specialized engineering domains:
- **NEC (National Electrical Code)**: NFPA 70 standards, conductor ampacity, overcurrent protection, conduit fill, Article 690/705 rules.
- **Wattmonk / Solar PV**: Solar PV plan-set criteria, AHJ compliance, string inverter calculations, rapid shutdown rules.
- **General Engineering**: Cross-disciplinary electrical and renewable energy engineering.

---

## Architecture Overview

The system strictly enforces separation of concerns across layers:

- **Presentation Layer (`app/`, `components/`, `hooks/`)**:
  - `components/chat/`: Message bubbles, progressive streaming rendering, citation cards, message composer with cancel controls.
  - `components/sidebar/`: Collapsible desktop navigation rail and responsive mobile drawer.
  - `components/context/`: Domain context partition selectors.
  - `hooks/useChatState.ts`: Isolated state model managing conversational flows, streaming deltas, cancellation (`AbortController`), and recoverable errors.
- **HTTP Gateway (`lib/chat-client.ts`, `lib/stream-parser.ts`, `lib/stream-protocol.ts`)**:
  - SSE protocol parser operating over native Web Streams (`ReadableStream<Uint8Array>`).
  - Discriminated union response envelope (`ApiResponse<T>`).
- **HTTP Route Handlers (`app/api/`)**:
  - Thin API route layer handling JSON validation, streaming response generation, and standardized error codes.
  - `POST /api/chat`: Primary endpoint for non-streaming and streaming LLM generation.
  - `GET /api/chat/sessions`, `POST /api/chat/sessions`, `DELETE /api/chat/sessions/[id]`: Session lifecycle.
  - `GET /api/contexts`: Context partition definitions.
- **Central Orchestration (`backend/services/chat-service.ts`)**:
  - Authoritative coordinator for conversational state, history windowing, domain system prompt assembly, provider resolution, and streaming generation.
  - **Zero Fabrication Guarantee**: Provider failures never generate fabricated answers or persist corrupt messages.
- **Provider Adapters (`backend/providers/`)**:
  - Common `ILlmProviderAdapter` interface.
  - `GeminiProvider`: Powered by the official `@google/genai` SDK.
  - `OpenRouterProvider`: Native `fetch` targeting OpenRouter's OpenAI-compatible completions endpoint.
  - `NvidiaProvider`: Native `fetch` targeting NVIDIA NIM's OpenAI-compatible completions endpoint.
  - `MockProvider`: Offline deterministic testing provider.
  - `ProviderRegistry`: Central provider resolver enforcing a strict failover policy (unconfigured providers immediately throw `CONFIGURATION_ERROR`).

---

## Environment Variables

Copy `.env.example` to `.env.local` to configure server-side credentials:

```bash
cp .env.example .env.local
```

### Exact Variable Names & Purpose

| Variable Name | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `DEFAULT_LLM_PROVIDER` | No | `gemini` | Active default provider (`gemini`, `openrouter`, `nvidia`, `mock`). |
| `MAX_HISTORY_MESSAGES` | No | `10` | Maximum recent turns included in LLM context window. |
| `GEMINI_API_KEY` | Conditional | *(None)* | Server API key for Google Gemini (`@google/genai` SDK). |
| `GEMINI_MODEL` | No | `gemini-2.5-flash` | Gemini model ID. |
| `OPENROUTER_API_KEY` | Conditional | *(None)* | Server API key for OpenRouter API. |
| `OPENROUTER_MODEL` | No | `meta-llama/llama-3.3-70b-instruct` | OpenRouter model ID. |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | OpenRouter API base URL override. |
| `NVIDIA_API_KEY` | Conditional | *(None)* | Server API key for NVIDIA NIM API. |
| `NVIDIA_MODEL` | No | `meta/llama-3.3-70b-instruct` | NVIDIA NIM model ID. |
| `NVIDIA_BASE_URL` | No | `https://integrate.api.nvidia.com/v1` | NVIDIA NIM API base URL override. |

> [!IMPORTANT]
> **Strict Server-Only Boundary**: Never prefix provider API keys with `NEXT_PUBLIC_`. All provider credentials and authorization headers reside strictly within server-side execution contexts and are never bundled into client-side assets.

---

## Development & Verification Commands

```bash
# Install dependencies
pnpm install

# Run automated unit & integration test suite (86+ tests across 26 suites)
pnpm test

# Run TypeScript strict type verification
pnpm typecheck

# Run Next.js linting
pnpm lint

# Compile optimized production build
pnpm build

# Start production server
pnpm start
```

---

## Testing Protocol & Live Status Safeguards

Automated test suites use deterministic fixtures and mocked external services for consistency, offline execution, and security across 199 unit and integration tests:
- `test/validation.test.ts`: Contracts, input validation, size limits, discriminated union narrowing.
- `test/providers.test.ts`: Provider adapters, error code mappings, token accounting, redactions.
- `test/chat-service.test.ts`: Central orchestration, routing, model whitelist, history bounds, streaming.
- `test/stream-parser.test.ts`: SSE packet fragmentation, interruptions, comments, AbortSignal cleanup.
- `test/day2-audit.test.ts`: Complete Day 2 integration audit verifying credential validation, rate limits, empty messages, severed connections, and client-side error states.
- `test/document-upload.test.ts`: Isolated PDF storage, path traversal defenses, size and extension validation.
- `test/extraction-chunker.test.ts`: PDF text extraction, scanned PDF detection, boundary prioritization (~1000/200 chars).
- `test/embeddings.test.ts`: Gemini `text-embedding-004` (768 dimensions), batching, rate limits, key redaction.
- `test/pinecone.test.ts`: `@pinecone-database/pinecone` integration, dimension matching, filters, deletion.
- `test/document-ingestion.test.ts`: End-to-end 6-step ingestion workflow, SHA-256 deduplication, error states.
- `test/day3-audit.test.ts`: Complete Day 3 end-to-end audit (valid 1-page & multi-page PDFs, malformed, empty-text, oversized, unsupported extension/MIME, deduplication, provider failure, Pinecone failure, document deletion).

### Day 3 Live vs. Mocked Verification Status

| Component | Verification Method | Status | Notes |
| :--- | :--- | :---: | :--- |
| **Real PDF Parsing** | Local execution via `unpdf` on binary PDF streams | **Individually Verified** | Tested on real 1-page, multi-page, scanned, and corrupt binary PDF streams without external network calls. |
| **Gemini Embeddings** | Server API key (`GEMINI_API_KEY`) via `@google/genai` | **Guarded / Unverified Live Integration** | Fully verified via deterministic mocked tests conforming to the official SDK. Without a valid key, fails closed with `CONFIGURATION_ERROR`. |
| **Pinecone Vector DB** | Server API key (`PINECONE_API_KEY`) via `@pinecone-database/pinecone` | **Guarded / Unverified Live Integration** | Fully verified via deterministic mocked tests conforming to the official SDK. Without a valid key, fails closed with `CONFIGURATION_ERROR`. |
| **In-Memory Fallback** | Local in-memory vector storage | **Individually Verified** | Explicitly labeled as `in-memory-non-persistent` (`isPersistent: false`). Never claimed equivalent to Pinecone. |

