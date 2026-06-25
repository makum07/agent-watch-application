'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ParsedMessage } from '@/lib/parser/jsonl-parser';

interface MessagesResponse {
  messages: ParsedMessage[];
  total: number;
  hasMore: boolean;
  page: number;
}

export function useAgentMessages(sessionId: string, agentId: string, refreshToken?: number) {
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [total, setTotal] = useState(0);

  // Track which agent we've fetched, and what page we're on
  const fetchedAgentRef = useRef<string>('');
  const pageRef = useRef(0);
  const loadingRef = useRef(false);

  // Reset when agent changes or refresh requested
  useEffect(() => {
    if (!agentId) return;
    setMessages([]);
    setHasMore(true);
    setIsLoading(false);
    setTotal(0);
    fetchedAgentRef.current = '';
    pageRef.current = 0;
    loadingRef.current = false;
  }, [sessionId, agentId, refreshToken]);

  // Auto-load first page after reset
  useEffect(() => {
    if (!agentId || !sessionId) return;
    fetchPage(sessionId, agentId, 0);
  }, [sessionId, agentId, refreshToken]);

  const fetchPage = useCallback(async (sid: string, aid: string, page: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);

    try {
      const res = await fetch(
        `/api/v2/sessions/${sid}/agent-messages?agentId=${aid}&page=${page}&limit=50`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MessagesResponse = await res.json();

      // Ignore stale responses if agent changed while fetching
      if (aid !== agentId || sid !== sessionId) return;

      setMessages(prev => page === 0 ? data.messages : [...prev, ...data.messages]);
      setHasMore(data.hasMore);
      setTotal(data.total);
      pageRef.current = page + 1;
      fetchedAgentRef.current = aid;
    } catch {
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [agentId, sessionId]);

  const loadMore = useCallback(() => {
    if (loadingRef.current || !hasMore) return;
    fetchPage(sessionId, agentId, pageRef.current);
  }, [sessionId, agentId, hasMore, fetchPage]);

  return { messages, loadMore, hasMore, isLoading, total };
}
