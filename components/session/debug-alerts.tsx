'use client';

import { useState } from 'react';
import { AlertTriangle, Repeat, Copy, Wrench, Database, Link, Info, AlertCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DebugAlert, AlertSeverity, AlertCategory } from '@/types/analytics';

interface DebugAlertsProps {
  alerts: DebugAlert[];
  agentNames?: Map<string, string>;
  onAgentClick?: (agentId: string) => void;
}

const SEVERITY_CONFIG: Record<AlertSeverity, { color: string; bg: string; border: string; icon: typeof XCircle }> = {
  critical: { color: '#f85149', bg: '#f85149/10', border: '#f85149/30', icon: XCircle },
  warning:  { color: '#d29922', bg: '#d29922/10', border: '#d29922/30', icon: AlertCircle },
  info:     { color: '#58a6ff', bg: '#58a6ff/10', border: '#58a6ff/30', icon: Info },
};

const CATEGORY_ICONS: Record<AlertCategory, typeof AlertTriangle> = {
  'bottleneck': AlertTriangle,
  'loop': Repeat,
  'duplicate-work': Copy,
  'excessive-tools': Wrench,
  'context-bloat': Database,
  'long-chain': Link,
};

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  'bottleneck': 'Bottleneck',
  'loop': 'Loop',
  'duplicate-work': 'Duplicate Work',
  'excessive-tools': 'Excessive Tools',
  'context-bloat': 'Context Bloat',
  'long-chain': 'Long Chain',
};

export function DebugAlerts({ alerts, agentNames, onAgentClick }: DebugAlertsProps) {
  const [severityFilter, setSeverityFilter] = useState<Set<AlertSeverity>>(new Set(['critical', 'warning', 'info']));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const filtered = alerts.filter(a => severityFilter.has(a.severity));

  const counts = {
    critical: alerts.filter(a => a.severity === 'critical').length,
    warning: alerts.filter(a => a.severity === 'warning').length,
    info: alerts.filter(a => a.severity === 'info').length,
  };

  const toggleSeverity = (s: AlertSeverity) => {
    setSeverityFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-xs text-[#3fb950]">
        <Info className="h-4 w-4" />
        No issues detected. Session looks healthy.
      </div>
    );
  }

  return (
    <div>
      {/* Severity filter toggles */}
      <div className="flex items-center gap-2 mb-3">
        {(['critical', 'warning', 'info'] as const).map(s => {
          const cfg = SEVERITY_CONFIG[s];
          const active = severityFilter.has(s);
          return (
            <button
              key={s}
              onClick={() => toggleSeverity(s)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all border',
                active
                  ? `text-[${cfg.color}] border-[${cfg.color}]/30 bg-[${cfg.color}]/10`
                  : 'text-[#484f58] border-[#21262d] bg-transparent'
              )}
              style={active ? { color: cfg.color, borderColor: `${cfg.color}30`, backgroundColor: `${cfg.color}15` } : undefined}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
              <span className="text-[10px] opacity-70">{counts[s]}</span>
            </button>
          );
        })}
        <span className="text-[10px] text-[#484f58] ml-auto">
          {filtered.length} of {alerts.length} shown
        </span>
      </div>

      {/* Alert cards */}
      <div className="space-y-2">
        {filtered.map(alert => {
          const cfg = SEVERITY_CONFIG[alert.severity];
          const SeverityIcon = cfg.icon;
          const CategoryIcon = CATEGORY_ICONS[alert.category];
          const isExpanded = expandedIds.has(alert.id);

          return (
            <div
              key={alert.id}
              className="rounded-lg border transition-colors cursor-pointer"
              style={{ borderColor: `${cfg.color}25`, backgroundColor: `${cfg.color}08` }}
              onClick={() => toggleExpanded(alert.id)}
            >
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <SeverityIcon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: cfg.color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-[#e6edf3]">{alert.title}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-[#8b949e]">
                    <span className="flex items-center gap-1">
                      <CategoryIcon className="h-3 w-3" />
                      {CATEGORY_LABELS[alert.category]}
                    </span>
                    {alert.metric !== undefined && alert.threshold !== undefined && (
                      <span>
                        {typeof alert.metric === 'number' && alert.metric < 1
                          ? `${(alert.metric * 100).toFixed(0)}%`
                          : String(Math.round(alert.metric))}
                        {' / '}
                        {typeof alert.threshold === 'number' && alert.threshold < 1
                          ? `${(alert.threshold * 100).toFixed(0)}%`
                          : String(Math.round(alert.threshold))}
                        {' threshold'}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-[#c9d1d9] leading-relaxed">{alert.description}</p>
                      {alert.agentIds.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {alert.agentIds.map(id => (
                            <button
                              key={id}
                              onClick={e => { e.stopPropagation(); onAgentClick?.(id); }}
                              className="text-[10px] px-2 py-0.5 rounded bg-[#21262d] text-[#58a6ff] hover:bg-[#30363d] transition-colors"
                            >
                              {agentNames?.get(id) || id.slice(0, 8)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
