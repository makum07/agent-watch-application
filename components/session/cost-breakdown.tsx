'use client';

import { useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { formatCost, formatTokens } from '@/lib/utils';
import type { SessionAnalytics } from '@/types/analytics';

const MODEL_COLORS = ['#58a6ff', '#bc8cff', '#3fb950', '#f0883e', '#ff9a85', '#f778ba'];
const ROUND_COLORS = ['#58a6ff', '#3fb950', '#f0883e', '#bc8cff', '#ff9a85', '#f778ba', '#79c0ff', '#56d364'];

interface CostBreakdownProps {
  costBreakdown: SessionAnalytics['costBreakdown'];
  onAgentClick?: (agentId: string) => void;
}

type View = 'model' | 'agent' | 'phase';

export function CostBreakdown({ costBreakdown, onAgentClick }: CostBreakdownProps) {
  const [activeView, setActiveView] = useState<View>('model');

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded bg-[#161b22] border border-[#21262d] w-fit">
        {(['model', 'agent', 'phase'] as const).map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              activeView === v
                ? 'bg-[#21262d] text-[#e6edf3] shadow-sm'
                : 'text-[#6e7681] hover:text-[#c9d1d9]'
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
              stroke="#0d1117"
              strokeWidth={2}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<ModelTooltip />} />
            <Legend
              formatter={(value: string) => <span className="text-xs text-[#c9d1d9]">{value}</span>}
              wrapperStyle={{ fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex-1 space-y-2 min-w-0">
        {data.map((d, i) => (
          <div key={d.model} className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: MODEL_COLORS[i % MODEL_COLORS.length] }} />
            <span className="text-xs font-mono text-[#c9d1d9] truncate w-40">{d.model.replace('claude-', '')}</span>
            <span className="text-xs text-[#8b949e]">{d.agentCount} agent{d.agentCount !== 1 ? 's' : ''}</span>
            <span className="text-xs font-mono text-[#e6edf3] ml-auto">{formatCost(d.cost)}</span>
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
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: '#8b949e', fontSize: 10 }}
            tickFormatter={(v: number) => formatCost(v)}
            axisLine={{ stroke: '#30363d' }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={160}
            tick={{ fill: '#c9d1d9', fontSize: 10 }}
            axisLine={{ stroke: '#30363d' }}
          />
          <Tooltip content={<AgentTooltip />} cursor={{ fill: '#21262d' }} />
          <Bar
            dataKey="cost"
            fill="#58a6ff"
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
          <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
          <XAxis
            dataKey="name"
            tick={{ fill: '#c9d1d9', fontSize: 10 }}
            axisLine={{ stroke: '#30363d' }}
          />
          <YAxis
            tick={{ fill: '#8b949e', fontSize: 10 }}
            tickFormatter={(v: number) => formatCost(v)}
            axisLine={{ stroke: '#30363d' }}
          />
          <Tooltip content={<PhaseTooltip />} cursor={{ fill: '#21262d' }} />
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
    <div className="bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[#e6edf3] mb-1">{d.name}</div>
      <div className="text-[#c9d1d9]">Cost: {formatCost(d.value)}</div>
      <div className="text-[#8b949e]">{formatTokens(d.tokens)} tokens · {d.agents} agents</div>
    </div>
  );
}

function AgentTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { fullName: string; cost: number; tokens: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[#e6edf3] mb-1">{d.fullName}</div>
      <div className="text-[#c9d1d9]">Cost: {formatCost(d.cost)}</div>
      <div className="text-[#8b949e]">{formatTokens(d.tokens)} tokens</div>
    </div>
  );
}

function PhaseTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; cost: number; tokens: number; agents: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-[#e6edf3] mb-1">{d.name}</div>
      <div className="text-[#c9d1d9]">Cost: {formatCost(d.cost)}</div>
      <div className="text-[#8b949e]">{formatTokens(d.tokens)} tokens · {d.agents} agents</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-32 text-xs text-[#6e7681]">
      No data available
    </div>
  );
}
