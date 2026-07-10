import { NextRequest, NextResponse } from 'next/server';
import { getWsServer } from '@/lib/websocket/ws-server';
import { randomUUID } from 'crypto';
import { getActiveCycleId, waitForApproval } from '@/lib/hooks/permission-state';

export async function POST(req: NextRequest) {
  const input = await req.json();
  const { tool_name, tool_input, session_id } = input;

  const cycleId = getActiveCycleId(session_id);
  if (!cycleId) {
    return NextResponse.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'No active improvement cycle for this session',
      },
    });
  }

  const wss = getWsServer();
  if (!wss) {
    return NextResponse.json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'WebSocket server unavailable',
      },
    });
  }

  const requestId = randomUUID();

  wss.broadcast({
    type: 'improvement_permission_request',
    sessionId: session_id,
    cycleId,
    requestId,
    toolName: tool_name,
    toolInput: tool_input,
  } as never);

  const approved = await waitForApproval(requestId);

  wss.broadcast({
    type: 'improvement_permission_resolved',
    sessionId: session_id,
    cycleId,
    requestId,
    approved,
  } as never);

  return NextResponse.json({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: approved ? 'allow' : 'deny',
      permissionDecisionReason: approved
        ? 'User approved via AgentWatch'
        : 'User denied via AgentWatch',
    },
  });
}
