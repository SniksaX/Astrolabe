'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuotaBar, StatusChip } from '@/components/dashboard/quota-bar';
import { FIXTURE_QUOTAS } from '@/lib/dashboard-fixtures';

export default function OffrePage() {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <section aria-labelledby="offre-heading" className="flex flex-col gap-6 p-6">
      <h1 id="offre-heading" className="text-heading font-bold">
        Offre et consommation
      </h1>

      <div className="space-y-4 rounded-sm border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-caption font-semibold">Offre actuelle — découverte</p>
          <div className="ml-auto">
            <StatusChip>Gratuite</StatusChip>
          </div>
        </div>
        <div className="space-y-3">
          <QuotaBar
            label="Questions"
            used={FIXTURE_QUOTAS.questions.used}
            max={FIXTURE_QUOTAS.questions.max}
          />
          <QuotaBar
            label="Sources"
            used={FIXTURE_QUOTAS.sources.used}
            max={FIXTURE_QUOTAS.sources.max}
          />
          <QuotaBar
            label="Pages indexées"
            used={FIXTURE_QUOTAS.pages.used}
            max={FIXTURE_QUOTAS.pages.max}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-sm border border-border p-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Découverte
          </p>
          <p className="text-heading font-bold">0 € / mois</p>
          <ul className="space-y-1.5 text-caption text-muted-foreground">
            <li>5 sources, 200 pages</li>
            <li>50 questions par mois</li>
            <li>Enrichissement contextuel désactivé</li>
            <li>Export et suppression inclus</li>
          </ul>
          <Button type="button" variant="outline" className="mt-auto" disabled>
            Offre actuelle
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-sm border-2 border-accent p-4">
          <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
            Complète
          </p>
          <p className="text-heading font-bold">Sans limite</p>
          <ul className="space-y-1.5 text-caption text-muted-foreground">
            <li>150 sources, 5 000 pages</li>
            <li>2 000 questions par mois</li>
            <li>Enrichissement contextuel activé</li>
            <li>Export et suppression inclus</li>
          </ul>
          <Button
            type="button"
            className="mt-auto"
            onClick={() =>
              setNotice(
                'Le paiement n’est pas encore branché — aucune redirection vers le prestataire.',
              )
            }
          >
            S&apos;abonner
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-dashed border-border p-3">
        <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">
          Le paiement est traité par notre prestataire sur sa propre page. Aucune donnée bancaire ne
          transite par Astrolabe.
        </p>
      </div>

      {notice ? (
        <p role="status" className="text-caption text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
