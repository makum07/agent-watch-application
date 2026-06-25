'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '@/store/session-store';

export function useSession(sessionId: string) {
  const { setSession, setError } = useSessionStore();
  const session = useSessionStore(s => s.session);
  const error = useSessionStore(s => s.error);

  const [isLoading, setIsLoading] = useState(!!sessionId);
  const fetchedFor = useRef<string>('');

  const doFetch = useCallback(() => {
    if (!sessionId) { setIsLoading(false); return; }
    fetchedFor.current = sessionId;
    setIsLoading(true);
    setError(null);
    fetch(`/api/v2/sessions/${sessionId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Session not found (${res.status})`);
        return res.json();
      })
      .then(data => { setSession(data); setIsLoading(false); })
      .catch(err => { setError(err.message); setIsLoading(false); });
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) { setIsLoading(false); return; }
    if (fetchedFor.current === sessionId && session?.id === sessionId) {
      setIsLoading(false);
      return;
    }
    doFetch();
  }, [sessionId]);

  const reload = useCallback(() => {
    fetchedFor.current = '';
    doFetch();
  }, [doFetch]);

  return { session: session?.id === sessionId ? session : null, isLoading, error, reload };
}
