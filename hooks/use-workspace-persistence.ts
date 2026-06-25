'use client';

import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/store/workspace-store';
import type { WorkspaceSnapshot } from '@/types/workspace';

export function useWorkspacePersistence(sessionId: string) {
  const store = useWorkspaceStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    if (!sessionId || !store.layout) return;

    const snapshot: WorkspaceSnapshot = {
      id: `auto_${sessionId}`,
      sessionId,
      savedAt: new Date().toISOString(),
      isAutoSave: true,
      name: null,
      layout: store.layout,
      paneStates: store.paneStates,
      sidebarCollapsed: store.sidebarCollapsed,
      sidebarWidth: store.sidebarWidth,
      globalSearchQuery: store.globalSearchQuery,
      activeFilters: store.activeFilters,
    };

    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSavedRef.current) return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/v2/workspaces/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serialized,
        });
        lastSavedRef.current = serialized;
      } catch {
        // silent fail
      }
    }, 2000);
  }, [sessionId, store.layout, store.paneStates, store.sidebarCollapsed, store.sidebarWidth]);

  const restoreSnapshot = async () => {
    try {
      const res = await fetch(`/api/v2/workspaces/${sessionId}/latest`);
      if (!res.ok) return null;
      const snapshot: WorkspaceSnapshot = await res.json();
      if (snapshot?.layout) {
        store.setLayout(snapshot.layout);
        if (snapshot.paneStates) {
          Object.entries(snapshot.paneStates).forEach(([paneId, state]) => {
            store.updatePaneState(paneId, state);
          });
        }
        // NOTE: sidebarCollapsed is intentionally NOT written to the store here.
        // The resizable Panel's pixel size is the single source of truth (its
        // onResize sets the store). Writing the boolean directly desyncs it from
        // the panel — the collapsed view renders inside a full-width panel and the
        // expand button can't recover. The caller drives the panel via its ref.
        if (snapshot.sidebarWidth) store.setSidebarWidth(snapshot.sidebarWidth);
      }
      return snapshot;
    } catch {
      return null;
    }
  };

  return { restoreSnapshot };
}
