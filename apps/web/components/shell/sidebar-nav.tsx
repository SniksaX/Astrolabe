'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversations } from '@/components/shell/conversations-context';
import { SidebarIdentity } from '@/components/shell/sidebar-identity';
import { deleteConversation } from '@/lib/api';
import { NAV_ITEMS } from '@/lib/nav';
import { cn } from '@/lib/utils';

/**
 * Contenu de la barre latérale (wireframes écrans 03/05/08/10/11), partagé
 * entre la barre latérale de bureau et le panneau de navigation mobile.
 */
export function SidebarNav({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { conversations, loading, refresh } = useConversations();

  async function handleDelete(event: React.MouseEvent, id: string): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    try {
      await deleteConversation(id);
      await refresh();
      if (pathname === `/chat/${id}`) router.push('/chat');
    } catch {
      // keep list as-is; user can retry
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <SidebarIdentity />

      <Button asChild variant="outline" className="justify-start gap-2">
        <Link href="/chat" onClick={onNavigate}>
          <Plus className="size-4" aria-hidden />
          Nouvelle conversation
        </Link>
      </Button>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          Conversations
        </span>
        <div className="min-w-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {loading ? (
            <p className="text-caption text-muted-foreground">Chargement…</p>
          ) : conversations.length === 0 ? (
            <p className="text-caption text-muted-foreground">Aucune conversation.</p>
          ) : (
            conversations.map((conversation) => {
              const href = `/chat/${conversation.id}`;
              const active = pathname === href;
              const label = conversation.title?.trim() || 'Nouvelle conversation';
              return (
                <div
                  key={conversation.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-sm',
                    active ? 'bg-selected' : 'hover:bg-selected/60',
                  )}
                >
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'min-w-0 flex-1 truncate px-2.5 py-2 text-caption font-semibold',
                      active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={label}
                  >
                    {label}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Supprimer ${label}`}
                    onClick={(event) => void handleDelete(event, conversation.id)}
                    className="mr-1 shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 hover:bg-canvas hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <hr className="border-border" />

      <nav aria-label="Principale" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-sm px-2.5 py-2 text-caption font-semibold',
                active
                  ? 'bg-selected text-foreground'
                  : 'text-muted-foreground hover:bg-selected hover:text-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
