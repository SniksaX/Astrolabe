import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { DashboardProviders } from '@/components/shell/dashboard-providers';
import { DesktopSidebar } from '@/components/shell/desktop-sidebar';
import { StatusBar } from '@/components/shell/status-bar';

const SESSION_COOKIE = 'astrolabe_session';

/**
 * Server-side guard: redirects before any dashboard markup renders if the
 * session cookie is absent. This only checks presence — middleware.ts backs
 * this up at the edge; actual JWT verification happens API-side on every
 * request via modules/auth's requireJwt, which is the real authority.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    redirect('/login');
  }

  return (
    <DashboardProviders>
      <div className="flex h-dvh overflow-hidden bg-canvas">
        <a href="#dashboard-main" className="skip-link">
          Skip to content
        </a>
        <DesktopSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar />
          <main id="dashboard-main" className="min-w-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </DashboardProviders>
  );
}
