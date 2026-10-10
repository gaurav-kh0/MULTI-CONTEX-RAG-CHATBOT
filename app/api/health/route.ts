import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    system: 'Multi-Context RAG Chatbot HTTP API',
    runtime: 'Next.js 14 App Router',
    timestamp: new Date().toISOString(),
  });
}
