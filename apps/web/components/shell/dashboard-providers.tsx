'use client';

import { ConversationsProvider } from '@/components/shell/conversations-context';
import type { ReactNode } from 'react';

/** Client boundary so the dashboard shell can share conversation list state. */
export function DashboardProviders({ children }: { children: ReactNode }) {
  return <ConversationsProvider>{children}</ConversationsProvider>;
}
