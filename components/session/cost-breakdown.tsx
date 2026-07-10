'use client';

import { useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { formatCost, formatTokens } from '@/lib/utils';
import type { SessionAnalytics } from '@/types/analytics';

const MODEL_COLORS = ['var(--aw-blue)', 'var(--aw-purple)', 'var(--aw-green)', 'var(--aw-orange)', 'var(--aw-red-light)', 'var(--aw-pink)'];
const ROUND_COLORS = ['var(--aw-blue)', 'var(--aw-green)', 'var(--aw-orange)', 'var(--aw-purple)', 'var(--aw-red-light)', 'var(--aw-pink)', 'var(--aw-blue-light)', 'var(--aw-green-56)'];

interface CostBreakdownProps {
  costBreakdown: SessionAnalytics['costBreakdown'];
  onAgentClick?: (agentId: string) => void;
}

type View = 'model' | 'agent' | 'phase';

export function CostBreakdown({ costBreakdown, onAgentClick }: CostBreakdownProps) {
  const [activeView, setActiveView] = useState<View>('model');

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded bg-[var(--aw-bg-1)] border border-[var(--aw-bg-2)] w-fit">
        {(['model', 'agent', 'phase'] as const).map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeView === v
                ? 'bg-[var(--aw-bg-2)] text-[var(--aw-text-0)] shadow-sm'
                : 'text-[var(--aw-text-3)] hover:text-[var(--aw-text-1)]'
            }`}
          >
            By {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {activeView === 'model' && <CostByModel data={costBreakdown.byModel} />}
      {activeView === 'agent' && <CostByAgent data={costBreakdown.byAgent} onAgentClick={onAgentClick} />}
      {activeView === 'phase' && <CostByPhase data={costBreakdown.byPhase} />}
    </div>
  );
}

function CostByModel({ data }: { data: SessionAnalytics['costBreakdown']['byModel'] }) {
  if (data.length === 0) return <EmptyState />;

  const pieData = data.map(d => ({
    name: d.model.replace('claude-', ''),
    value: d.cost,
    tokens: d.tokens,
    agents: d.agentCount,
  }));

  return (
    <div className="flex flex-col lg:flex-row items-start gap-6">
      <div className="w-full lg:w-64 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              outerRadius={80}
              innerRadius={40}
              dataKey="value"
              stroke="var(--aw-bg-0)"
              strokeWidth={2}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ModelTooltip />} />
            <Legend
              formatter={(value: string) => <span className="text-xs text-[var(--aw-text-1)]">{value}</span>}
              wrapperStyle={{ fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 min-w-0">
        {data.map((d, i) => (
          <div key={d.model} className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }} />
            <span className="text-xs font-mono text-[var(--aw-text-1)] truncate w-40">{d.model.replace('claude-', '')}</span>
            <span className="text-xs text-[var(--aw-text-2)]">{d.agentCount} agent{d.agentCount !== 1 ? 's' : ''}</span>
            <span className="text-xs font-mono text-[var(--aw-text-0)] ml-auto">{formatCost(d.cost)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostByAgent({ data, onAgentClick }: {
  data: SessionAnalytics['costBreakdown']['byAgent'];
  onAgentClick?: (agentId: string) => void;
}) {
  const top15 = data.slice(0, 15);
  if (top15.length === 0) return <EmptyState />;

  const chartData = top15.map(d => ({
    name: d.name.length > 25 ? d.name.slice(0, 23) + '…' : d.name,
    cost: d.cost,
    fullName: d.name,
    agentId: d.agentId,
    tokens: d.tokens,
  }));

  return (
    <div className="w-full" style={{ height: Math.max(200, top15.length * 32 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--aw-bg-2)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'var(--aw-text-2)', fontSize: 10 }}
            tickFormatter={(v: number) => formatCost(v)}
            axisLine={{ stroke: 'var(--aw-bg-3)' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fill: 'var(--aw-text-1)', fontSize: 10 }}
            axisLine={{ stroke: 'var(--aw-bg-3)' }}
          />
          <Tooltip content={<AgentTooltip />} cursor={{ fill: 'var(--aw-bg-2)' }} />
          <Bar
            dataKey="cost"
            fill="var(--aw-blue)"
            radius={[0, 4, 4, 0]}
            cursor={onAgentClick ? 'pointer' : undefined}
            onClick={(_data: unknown, index: number) => {
              const entry = chartData[index];
              if (onAgentClick && entry?.agentId) onAgentClick(entry.agentId);
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostByPhase({ data }: { data: SessionAnalytics['costBreakdown']['byPhase'] }) {
  if (data.length === 0) return <EmptyState />;

  const chartData = data.map((d, i) => ({
    name: d.phase,
    cost: d.cost,
    tokens: d.tokens,
    agents: d.agentCount,
    fill: ROUND_COLORS[i % ROUND_COLORS.length],
  }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ left: 10, right: 30, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--aw-bg-2)" />
          <XAxis
            dataKey="name"
            tick={{ fill: 'var(--aw-text-1)', fontSize: 10 }}
            axisLine={{ stroke: 'var(--aw-bg-3)' }}
          />
          <YAxis
            tick={{ fill: 'var(--aw-text-2)', fontSize: 10 }}
            tickFormatter={(v: number) => formatCost(v)}
            axisLine={{ stroke: 'var(--aw-bg-3)' }}
          />
          <Tooltip content={<PhaseTooltip />} cursor={{ fill: 'var(--aw-bg-2)' }} />
          <Bar dataKey="cost" radius={[4, 4, 0, 0]}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Custom tooltips ─────────────────────────────────────────────────────

function ModelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; tokens: number; agents: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[var(--aw-text-0)] mb-1">{d.name}</div>
      <div className="text-[var(--aw-text-1)]">Cost: {formatCost(d.value)}</div>
      <div className="text-[var(--aw-text-2)]">{formatTokens(d.tokens)} tokens · {d.agents} agents</div>
    </div>
  );
}

function AgentTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fullName: string; cost: number; tokens: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[var(--aw-text-0)] mb-1">{d.fullName}</div>
      <div className="text-[var(--aw-text-1)]">Cost: {formatCost(d.cost)}</div>
      <div className="text-[var(--aw-text-2)]">{formatTokens(d.tokens)} tokens</div>
    </div>
  );
}

function PhaseTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; cost: number; tokens: number; agents: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[var(--aw-bg-1)] border border-[var(--aw-bg-3)] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[var(--aw-text-0)] mb-1">{d.name}</div>
      <div className="text-[var(--aw-text-1)]">Cost: {formatCost(d.cost)}</div>
      <div className="text-[var(--aw-text-2)]">{formatTokens(d.tokens)} tokens · {d.agents} agents</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-32 text-xs text-[var(--aw-text-3)]">
      No data available
    </div>
  );
}
