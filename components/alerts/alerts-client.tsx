'use client';

import { NavBar } from '@/components/shared/navbar';
import { ThresholdAlerts } from '@/components/alerts/threshold-alerts';
import {
  SidebarInset, SidebarProvider,
} from '@/components/ui/sidebar';

export function AlertsClient() {
  return (
    <SidebarProvider>
      <SidebarInset className="flex flex-col h-screen overflow-hidden">
        <NavBar activePage="alerts" />

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">
            <ThresholdAlerts />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
