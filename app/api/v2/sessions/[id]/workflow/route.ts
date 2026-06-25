import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { parseJsonlFile } from '@/lib/parser/jsonl-parser';
import { extractWorkflowMeta, assignAgentsToPhases } from '@/lib/services/workflow-parser';
import type { WorkflowInfo } from '@/lib/services/workflow-parser';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = getDatabase();

    // Find all agents and their JSONL paths for this session
    const agentRows = db.prepare(
      'SELECT id, type, subagent_type, description, jsonl_path, start_time FROM agents WHERE session_id = ?'
    ).all(id) as Array<{
      id: string;
      type: string;
      subagent_type: string | null;
      description: string | null;
      jsonl_path: string | null;
      start_time: number | null;
    }>;

    const workflows: WorkflowInfo[] = [];

    for (const agent of agentRows) {
      if (!agent.jsonl_path) continue;

      // Parse messages to find Workflow tool_use blocks
      const parsed = parseJsonlFile(agent.jsonl_path);

      for (const msg of parsed.messages) {
        if (msg.role !== 'assistant') continue;

        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;
          if (block.name !== 'Workflow') continue;

          const script = (block.input as Record<string, unknown>).script as string | undefined;
          if (!script) continue;

          const { name, description, phaseNames } = extractWorkflowMeta(script);

          // Find child agents spawned after this tool_use (heuristic: children of this agent)
          const childAgents = agentRows
            .filter(a => {
              // Find agents that are workflow subagents and started around when this workflow ran
              return a.type !== 'orchestrator' && a.start_time != null;
            })
            .map(a => ({
              id: a.id,
              description: a.description,
              startTime: a.start_time ? new Date(a.start_time).toISOString() : new Date().toISOString(),
            }));

          const phases = assignAgentsToPhases(childAgents, phaseNames);

          workflows.push({
            agentId: agent.id,
            name,
            description,
            phases,
          });

          // Only handle the first Workflow call per agent
          break;
        }
      }
    }

    return NextResponse.json({ workflows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
