'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusChip } from '@/components/dashboard/quota-bar';
import { useTheme } from '@/components/theme-provider';
import { logout } from '@/lib/api';
import type { ThemePreference } from '@/lib/theme';

const SECTIONS = [
  { id: 'apparence', label: 'Apparence' },
  { id: 'traitement', label: 'Traitement' },
  { id: 'voix', label: 'Voix' },
  { id: 'donnees', label: 'Mes données' },
  { id: 'session', label: 'Session' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const THEME_OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: 'light', label: 'Clair', hint: 'Toujours le thème clair de la charte' },
  { value: 'dark', label: 'Sombre', hint: 'Toujours le thème sombre' },
  { value: 'system', label: 'Système', hint: 'Suit le réglage du système d’exploitation' },
];

const NOT_AVAILABLE =
  "Cette action n'est pas encore disponible — l'export et la suppression de compte restent à brancher côté API.";

type ConfirmKind = 'export' | 'purge' | 'delete-account' | null;

export default function ReglagesPage() {
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const [active, setActive] = useState<SectionId>('apparence');
  const [loggingOut, setLoggingOut] = useState(false);
  const [keepTranscripts, setKeepTranscripts] = useState(true);
  const [voices, setVoices] = useState<string[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setVoices(['Voix du système']);
      setSelectedVoice('Voix du système');
      return;
    }
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      const names = list.length > 0 ? list.map((v) => v.name) : ['Voix du système'];
      setVoices(names);
      setSelectedVoice((prev) => prev || names[0] || 'Voix du système');
    };
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      router.push('/login');
    }
  }

  function scrollToSection(id: SectionId): void {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-6 lg:flex-row lg:gap-8">
      <nav aria-label="Rubriques des réglages" className="w-full shrink-0 lg:sticky lg:top-4 lg:w-44 lg:self-start">
        <p className="mb-2 text-caption font-semibold text-muted-foreground">Réglages</p>
        <ul className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((item) => {
            const isCurrent = active === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={[
                    'w-full rounded-sm px-3 py-2 text-left text-caption',
                    isCurrent
                      ? 'bg-selected font-semibold text-foreground'
                      : 'font-normal text-muted-foreground hover:bg-selected/60',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 space-y-6">
        <h1 className="text-heading font-bold">Réglages — traitement et données</h1>

        <section id="apparence" aria-labelledby="apparence-heading" className="space-y-3 rounded-sm border border-border p-4">
          <h2 id="apparence-heading" className="text-caption font-semibold">
            Apparence
          </h2>
          <p className="text-caption text-muted-foreground">
            Thème de l&apos;interface. Le choix est mémorisé sur cet appareil.
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Thème</legend>
            {THEME_OPTIONS.map((option) => {
              const checked = preference === option.value;
              return (
                <label
                  key={option.value}
                  className={[
                    'flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2',
                    checked ? 'border-accent bg-selected' : 'border-border',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={option.value}
                    checked={checked}
                    onChange={() => setPreference(option.value)}
                    className="mt-1 size-4"
                  />
                  <span>
                    <span className="block text-body font-semibold">{option.label}</span>
                    <span className="block text-caption text-muted-foreground">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        </section>

        <section id="traitement" aria-labelledby="traitement-heading" className="space-y-3 rounded-sm border border-border p-4">
          <h2 id="traitement-heading" className="text-caption font-semibold">
            Traitement des contenus
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-caption text-muted-foreground">Fournisseur d&apos;inférence</p>
              <p className="text-body font-semibold">Compatible OpenAI — hébergé en Europe</p>
            </div>
            <StatusChip>Union européenne</StatusChip>
          </div>
          <hr className="border-border" />
          <p className="text-caption text-muted-foreground">
            Vos contenus ne sont utilisés ni pour entraîner, ni pour spécialiser un modèle.
          </p>
          <p className="text-caption text-muted-foreground">Aucun transfert vers un pays tiers.</p>
        </section>

        <section id="voix" aria-labelledby="voix-heading" className="space-y-4 rounded-sm border border-border p-4">
          <h2 id="voix-heading" className="text-caption font-semibold">
            Voix
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-caption text-muted-foreground">Voix de restitution</p>
              <p className="text-caption text-muted-foreground">Fournie par votre navigateur</p>
            </div>
            <label className="sr-only" htmlFor="voice-select">
              Voix de restitution
            </label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(event) => setSelectedVoice(event.target.value)}
              className="min-w-[160px] rounded-xs border border-border bg-surface px-3 py-2 text-caption"
            >
              {voices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-caption">
            <input
              type="checkbox"
              checked={keepTranscripts}
              onChange={(event) => setKeepTranscripts(event.target.checked)}
              className="size-4 rounded-xs border-border"
            />
            Conserver les transcriptions — 30 jours
          </label>
        </section>

        <section id="donnees" aria-labelledby="donnees-heading" className="rounded-sm border border-border">
          <h2 id="donnees-heading" className="border-b border-border px-4 py-3 text-caption font-semibold">
            Mes données
          </h2>
          <DataRow
            title="Exporter mes données"
            description="Export complet au format JSON"
            actionLabel="Exporter"
            onAction={() => setConfirm('export')}
          />
          <hr className="border-border" />
          <DataRow
            title="Purger le corpus"
            description="Supprimer toutes mes sources et leurs fragments"
            actionLabel="Purger"
            onAction={() => setConfirm('purge')}
          />
          <hr className="border-border" />
          <DataRow
            title="Supprimer mon compte"
            description="Suppression définitive du compte et de toutes les données"
            actionLabel="Supprimer"
            destructive
            onAction={() => setConfirm('delete-account')}
          />
        </section>

        <section id="session" aria-labelledby="session-heading" className="rounded-sm border border-border p-4">
          <h2 id="session-heading" className="text-caption font-semibold">
            Session
          </h2>
          <p className="mt-2 text-caption text-muted-foreground">
            Met fin à la session sur cet appareil et efface les cookies d&apos;authentification.
          </p>
          <Button variant="outline" className="mt-4" onClick={handleLogout} disabled={loggingOut}>
            {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </Button>
        </section>

        {notice ? (
          <p role="status" className="text-caption text-muted-foreground">
            {notice}
          </p>
        ) : null}
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'export'
                ? 'Exporter les données'
                : confirm === 'purge'
                  ? 'Purger le corpus'
                  : 'Supprimer le compte'}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'export'
                ? 'Un fichier JSON contenant vos données sera préparé.'
                : confirm === 'purge'
                  ? 'Toutes vos sources et leurs fragments seront supprimés. Cette action est irréversible.'
                  : 'Le compte et toutes les données associées seront définitivement supprimés.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant={confirm === 'delete-account' ? 'destructive' : 'default'}
              onClick={() => {
                setNotice(NOT_AVAILABLE);
                setConfirm(null);
              }}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DataRow({
  title,
  description,
  actionLabel,
  onAction,
  destructive,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  destructive?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-body font-semibold">{title}</p>
        <p className="text-caption text-muted-foreground">{description}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={destructive ? 'destructive' : 'outline'}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
