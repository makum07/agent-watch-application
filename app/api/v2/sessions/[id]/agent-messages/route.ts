import { NextRequest, NextResponse } from 'next/server';
import { getAgentMessages } from '@/lib/services/session-ingester';

// Flat route: GET /api/v2/sessions/:id/agent-messages?agentId=...&page=0&limit=50
// Avoids double dynamic segments which Turbopack doesn't handle well
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const agentId = url.searchParams.get('agentId');
    const page = parseInt(url.searchParams.get('page') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
    }

    const result = getAgentMessages(id, agentId, page, Math.min(limit, 100));

    if (!result) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
