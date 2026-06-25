'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDuration, formatRelativeTime } from '@/lib/utils';

interface ExecutionRow {
  id: string;
  sessionId: string;
  agentId: string;
  timestamp: string;
  durationMs: number | null;
  args: string | null;
  feedbackCount: number;
  agentName?: string | null;
}

interface ExecutionHistoryProps {
  skillId: string;
}

export function ExecutionHistory({ skillId }: ExecutionHistoryProps) {
  const [executions, setExecutions] = useState<ExecutionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v2/skills/${skillId}/executions?limit=${pageSize}&offset=${p * pageSize}`);
      if (!res.ok) return;
      const data = await res.json();
      setExecutions(data.executions);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  useEffect(() => { load(page); }, [load, page]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--aw-text-2)]">
          {total} execution{total !== 1 ? 's' : ''}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-[var(--aw-bg-2)] disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-[var(--aw-text-2)]">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-[var(--aw-bg-2)] disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8">
          <div className="h-5 w-5 border-2 border-[var(--aw-blue)] border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : executions.length === 0 ? (
        <div className="text-center py-8 text-[var(--aw-text-2)] text-xs">No executions found</div>
      ) : (
        <div className="border border-[var(--aw-bg-3)] rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[var(--aw-bg-1)] text-[var(--aw-text-2)]">
                <th className="text-left px-3 py-2 font-medium">Session</th>
                <th className="text-left px-3 py-2 font-medium">Agent</th>
                <th className="text-left px-3 py-2 font-medium">Timestamp</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
                <th className="text-right px-3 py-2 font-medium">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {executions.map(exec => (
                <tr key={exec.id} className="border-t border-[var(--aw-bg-2)] hover:bg-[var(--aw-bg-1)]">
                  <td className="px-3 py-2">
                    <Link
                      href={`/session/${exec.sessionId}/workspace`}
                      className="text-[var(--aw-blue)] hover:underline font-mono"
                    >
                      {exec.sessionId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[var(--aw-text-1)] max-w-[200px] truncate">
                    {exec.agentName || exec.agentId.slice(0, 12)}
                  </td>
                  <td className="px-3 py-2 text-[var(--aw-text-2)]">
                    {formatRelativeTime(exec.timestamp)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--aw-text-1)]">
                    {exec.durationMs != null ? formatDuration(exec.durationMs) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {exec.feedbackCount > 0 ? (
                      <span className="text-[var(--aw-orange-bright)]">{exec.feedbackCount}</span>
                    ) : (
                      <span className="text-[var(--aw-text-4)]">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
