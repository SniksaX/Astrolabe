import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Astrolabe — un assistant documentaire à réponses vérifiables',
  description:
    'Astrolabe indexe vos PDF, pages web et vidéos et répond à vos questions en citant le passage exact dont provient chaque réponse. Traitement hébergé en Europe.',
};

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border px-2.5 py-1 text-caption text-muted-foreground">{children}</span>
  );
}

function Argument({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-sm bg-surface p-6">
      <h2 className="text-heading font-bold">{title}</h2>
      <p className="mt-2 text-body text-muted-foreground">{children}</p>
    </div>
  );
}

function Plan({
  label,
  name,
  cta,
  variant,
  children,
}: {
  label: string;
  name: string;
  cta: string;
  variant: 'outline' | 'default';
  children: ReactNode;
}) {
  return (
    <div className="flex grow flex-col gap-2 rounded-sm border border-border bg-surface p-6">
      <span className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <h2 className="text-heading font-bold">{name}</h2>
      <p className="text-body text-muted-foreground">{children}</p>
      <Button asChild variant={variant} className="mt-2 self-start">
        <Link href="/inscription">{cta}</Link>
      </Button>
    </div>
  );
}

export default function MarketingHomePage() {
  return (
    <>
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-16 text-center">
        <h1 className="max-w-3xl text-display font-bold">{'Interrogez vos documents, avec les sources à l’appui'}</h1>
        <p className="max-w-2xl text-display-sm text-muted-foreground">
          PDF, pages web et vidéos : un seul assistant, des réponses toujours vérifiables.
        </p>
        <p className="max-w-xl text-body text-muted-foreground">
          {'Chaque réponse cite le passage exact dont elle provient. Vos documents et vos échanges restent traités par un fournisseur d’inférence basé en Europe.'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/inscription">Commencer gratuitement</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#tarifs">Voir les tarifs</Link>
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Chip>PDF, DOCX, pages web, vidéos</Chip>
          <Chip>Réponses sourcées</Chip>
          <Chip>Traitement en Europe</Chip>
        </div>
        <div
          role="img"
          aria-label="Aperçu de l'interface Astrolabe : conversation avec citations"
          className="flex h-56 w-full max-w-3xl items-center justify-center rounded-sm border border-dashed border-border bg-canvas text-caption text-muted-foreground"
        >
          {'Capture de l’interface — à venir'}
        </div>
      </section>

      <section id="fonctionnalites" className="bg-canvas px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-3">
          <Argument title="Des réponses vérifiables">
            {'Chaque réponse s’appuie sur un passage précis de vos documents, jamais une affirmation sans source.'}
          </Argument>
          <Argument title="Quatre formats, une seule recherche">
            {'PDF, DOCX, pages web et vidéos sont indexés ensemble et interrogés d’un seul geste.'}
          </Argument>
          <Argument title="Traitement en Europe">
            {'Vos documents et vos échanges sont hébergés et traités par un fournisseur d’inférence basé dans l’Union européenne.'}
          </Argument>
        </div>
      </section>

      <section id="tarifs" className="px-6 py-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row">
          <Plan label="Découverte" name="Gratuit" cta="Commencer" variant="outline">
            Un nombre de questions limité chaque mois, pour essayer avec vos propres documents.
          </Plan>
          <Plan label="Complète" name="Sans limite" cta={'S’abonner'} variant="default">
            Questions illimitées, historique complet de vos conversations, traitement prioritaire.
          </Plan>
        </div>
      </section>
    </>
  );
}
