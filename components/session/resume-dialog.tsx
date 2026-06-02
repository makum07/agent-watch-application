'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw, LayoutDashboard, Clock, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResumeDialogProps {
  sessionId: string;
}

export function ResumeDialog({ sessionId }: ResumeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/v2/workspaces/${sessionId}/latest`)
      .then(r => { if (r.ok) setHasSnapshot(true); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  const navigate = (view: string) => {
    setOpen(false);
    router.push(`/session/${sessionId}/${view}`);
  };

  const options = [
    {
      id: 'workspace',
      icon: <Layers className="h-5 w-5" />,
      label: hasSnapshot ? 'Resume Last Workspace' : 'Open Workspace',
      description: hasSnapshot ? 'Continue where you left off' : 'Open the multi-pane workspace',
      primary: true,
    },
    {
      id: 'timeline',
      icon: <Clock className="h-5 w-5" />,
      label: 'Timeline View',
      description: 'Visualize agent execution over time',
    },
    {
      id: 'analytics',
      icon: <LayoutDashboard className="h-5 w-5" />,
      label: 'Analytics',
      description: 'Tokens, costs, and session metrics',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) navigate('workspace'); }}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Open Session</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            How would you like to view this session?
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {options.map(opt => (
              <button
                key={opt.id}
                onClick={() => navigate(opt.id)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors',
                  opt.primary
                    ? 'border-primary bg-primary/10 hover:bg-primary/20 text-foreground'
                    : 'border-border hover:bg-accent text-muted-foreground hover:text-foreground'
                )}
              >
                <div className={cn('shrink-0', opt.primary ? 'text-primary' : 'text-muted-foreground')}>
                  {opt.icon}
                </div>
                <div>
                  <div className={cn('text-sm font-medium', opt.primary ? 'text-foreground' : '')}>{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
