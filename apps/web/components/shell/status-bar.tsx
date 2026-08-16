import Link from 'next/link';
import type { ReactNode } from 'react';
import { CircleUserRound } from 'lucide-react';
import { MobileNav } from '@/components/shell/mobile-nav';

/**
 * Bandeau d'état (wireframes écrans 03/05, zone B) : quota et localisation
 * du traitement affichés en permanence sur tout l'espace authentifié
 * (§ Standards d'ergonomie retenus — Visibilité de l'état). Sous 720 px
 * (wireframe écran 12, zone A), les puces passent sur une seconde ligne
 * plutôt que de se compresser à côté du menu et de l'icône de compte.
 */
export function StatusBar() {
  return (
    <header className="flex flex-wrap items-center gap-y-2 border-b border-border bg-surface px-4 py-3">
      <MobileNav />
      <div className="ml-auto flex items-center gap-2">
        <CommandChip>50 questions / mois</CommandChip>
        <CommandChip>Traitement en Europe</CommandChip>
        <Link
          href="/reglages"
          aria-label="Réglages du compte"
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-selected hover:text-foreground"
        >
          <CircleUserRound className="size-5" aria-hidden />
        </Link>
      </div>
    </header>
  );
}

function CommandChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-1 text-caption text-muted-foreground">
      {children}
    </span>
  );
}
