import { NextRequest, NextResponse } from 'next/server';
import { getAgentMessages } from '@/lib/services/session-ingester';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const { id, agentId } = await params;
    const url = new URL(req.url);
    const page = parseInt(url.searchParams.get('page') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const result = getAgentMessages(id, agentId, page, Math.min(limit, 100));

    if (!result) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
