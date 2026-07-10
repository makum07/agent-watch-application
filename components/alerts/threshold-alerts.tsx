'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, CheckCircle, XCircle, ExternalLink, RefreshCw, Settings } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ThresholdAlert {
  id: string;
  sessionId: string;
  source: string;
  project: string;
  title: string;
  thresholdType: 'cost' | 'duration';
  thresholdValue: number;
  actualValue: number;
  status: 'active' | 'resolved' | 'dismissed';
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  sessionCost: number;
  sessionTokens: number;
  sessionDurationMs: number;
}

function fmtCost(n: number) { return `$${n.toFixed(2)}`; }
function fmtTokens(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n); }
function fmtDuration(ms: number) {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}
function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}
function stripTags(str: string) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/<[^>]*$/g, '').replace(/\s+/g, ' ').trim();
}

function AlertCard({ alert, onDismiss }: { alert: ThresholdAlert; onDismiss?: (id: string) => void }) {
  const title = stripTags(alert.title);
  const truncTitle = title.length > 70 ? title.slice(0, 67) + '…' : title;

  const isActive = alert.status === 'active';
  const thresholdLabel = alert.thresholdType === 'cost'
    ? `Cost threshold: ${fmtCost(alert.thresholdValue)}`
    : `Duration threshold: ${fmtDuration(alert.thresholdValue)}`;
  const actualLabel = alert.thresholdType === 'cost'
    ? fmtCost(alert.actualValue)
    : fmtDuration(alert.actualValue);

  return (
    <div className={cn(
      'border rounded-lg overflow-hidden',
      isActive ? 'border-destructive/50 bg-destructive/5' : 'border-border',
    )}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="mt-0.5">
          {isActive ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : alert.status === 'resolved' ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/session/${alert.sessionId}/workspace`}
              className="text-sm font-medium truncate hover:text-primary transition-colors"
            >
              {truncTitle}
            </Link>
            <Badge variant={isActive ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
              {alert.status}
            </Badge>
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{thresholdLabel}</span>
            <span>·</span>
            <span className={isActive ? 'text-destructive font-medium' : ''}>
              actual: {actualLabel}
            </span>
            <span>·</span>
            <span>{alert.source}</span>
            <span>·</span>
            <span>{timeAgo(alert.createdAt)}</span>
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{fmtCost(alert.sessionCost)} cost</span>
            <span>·</span>
            <span>{fmtTokens(alert.sessionTokens)} tokens</span>
            <span>·</span>
            <span>{fmtDuration(alert.sessionDurationMs)} duration</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/session/${alert.sessionId}/workspace`}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Open session workspace"
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>
          {isActive && onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors text-muted-foreground"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ThresholdSettings({ onSaved }: { onSaved: () => void }) {
  const [costThreshold, setCostThreshold] = useState<string>('');
  const [durationHours, setDurationHours] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/v2/preferences')
      .then(r => r.json())
      .then(d => {
        setCostThreshold(String(d.alertCostThreshold ?? 5));
        setDurationHours(String(d.alertDurationThresholdHours ?? 0));
        setWebhookUrl(d.teamsWebhookUrl ?? '');
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    await Promise.all([
      fetch('/api/v2/preferences/alertCostThreshold', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parseFloat(costThreshold) || 0 }),
      }),
      fetch('/api/v2/preferences/alertDurationThresholdHours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parseFloat(durationHours) || 0 }),
      }),
      fetch('/api/v2/preferences/teamsWebhookUrl', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: webhookUrl.trim() }),
      }),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!loaded) return null;

  return (
    <div className="border border-border rounded-lg p-4 bg-muted/20 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Cost threshold ($)
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={costThreshold}
            onChange={e => setCostThreshold(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="5"
          />
          <p className="text-[10px] text-muted-foreground mt-1">Alert when session cost exceeds this. 0 = disabled.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1.5">
            Duration threshold (hours)
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={durationHours}
            onChange={e => setDurationHours(e.target.value)}
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="0"
          />
          <p className="text-[10px] text-muted-foreground mt-1">Alert when session runs longer than this. 0 = disabled.</p>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1.5">
          Teams webhook URL
        </label>
        <input
          type="url"
          value={webhookUrl}
          onChange={e => setWebhookUrl(e.target.value)}
          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="https://prod-XX.westeurope.logic.azure.com/..."
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          Power Automate webhook for Teams notifications. Leave empty to disable.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        {saved && <span className="text-xs text-green-500">Saved</span>}
        <button
          onClick={save}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export function ThresholdAlerts() {
  const [alerts, setAlerts] = useState<ThresholdAlert[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const loadAlerts = useCallback(() => {
    fetch('/api/v2/alerts?limit=50')
      .then(r => r.json())
      .then(d => {
        setAlerts(d.alerts ?? []);
        setActiveCount(d.activeCount ?? 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadAlerts();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === 'threshold_alert_created' || event.type === 'threshold_alert_updated') {
          loadAlerts();
        }
      } catch { /* ignore */ }
    };

    return () => ws.close();
  }, [loadAlerts]);

  async function dismissAlert(id: string) {
    await fetch(`/api/v2/alerts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'dismissed' }),
    });
    loadAlerts();
  }

  const active = alerts.filter(a => a.status === 'active');
  const resolved = alerts.filter(a => a.status !== 'active');

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Threshold Alerts</h2>
          {activeCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {activeCount} active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(o => !o)}
            className={cn(
              'p-1.5 rounded transition-colors',
              showSettings
                ? 'text-primary bg-primary/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            title="Configure thresholds"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={loadAlerts}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Refresh alerts"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="mb-3">
          <ThresholdSettings onSaved={() => setShowSettings(false)} />
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-2">
              {active.map(alert => (
                <AlertCard key={alert.id} alert={alert} onDismiss={dismissAlert} />
              ))}
            </div>
          )}

          {active.length === 0 && resolved.length === 0 && !showSettings && (
            <p className="text-sm text-muted-foreground py-2">
              No alerts — sessions are monitored every 30s against your configured thresholds.
            </p>
          )}

          {resolved.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowResolved(o => !o)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
              </button>
              {showResolved && (
                <div className="space-y-2 mt-2 opacity-60">
                  {resolved.map(alert => (
                    <AlertCard key={alert.id} alert={alert} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
