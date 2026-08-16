'use client';

import { useEffect, useState } from 'react';
import { getMe } from '@/lib/api';

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  if (!local) return 'Utilisateur';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * Brand + signed-in user at the top of the sidebar (wireframe: identity in shell).
 */
export function SidebarIdentity() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    void getMe()
      .then((me) => setEmail(me.email))
      .catch(() => setEmail(null));
  }, []);

  const name = email ? displayNameFromEmail(email) : 'Astrolabe';
  const initial = name.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col gap-3">
      <div className="text-body font-semibold tracking-tight">Astrolabe</div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground"
        >
          {initial}
        </span>
        <div className="min-w-0">
          <p className="truncate text-caption font-semibold text-foreground">{name}</p>
          {email ? (
            <p className="truncate text-caption text-muted-foreground">{email}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
