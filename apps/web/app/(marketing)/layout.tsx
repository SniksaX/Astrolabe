import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/** Static/SSG shell for public, SEO-facing pages — no auth, no client JS required. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground"
            >
              A
            </span>
            <span className="text-body font-semibold">Astrolabe</span>
          </Link>
          <nav aria-label="Principale" className="ml-auto flex items-center gap-6">
            <Link href="#fonctionnalites" className="text-caption font-semibold text-muted-foreground hover:text-foreground">
              Fonctionnalités
            </Link>
            <Link href="#tarifs" className="text-caption font-semibold text-muted-foreground hover:text-foreground">
              Tarifs
            </Link>
            <Link href="/login" className="text-caption font-semibold text-muted-foreground hover:text-foreground">
              Connexion
            </Link>
            <Button asChild size="sm">
              <Link href="/inscription">Créer un compte</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="border-t border-border bg-canvas">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-6 text-caption text-muted-foreground">
          <span className="font-semibold text-foreground">Astrolabe</span>
          <span>Assistant documentaire à citations vérifiables</span>
          <span>Traitement en Europe</span>
          <div className="grow" />
          <span>Politique de confidentialité — à venir</span>
        </div>
      </footer>
    </>
  );
}
