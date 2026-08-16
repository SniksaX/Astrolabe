'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QuotaBar } from '@/components/dashboard/quota-bar';
import { ApiError, createUrlDocument, uploadDocument } from '@/lib/api';
import { FIXTURE_QUOTAS } from '@/lib/dashboard-fixtures';

type Tab = 'file' | 'web' | 'video';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'] as const;

const inputClass =
  'min-w-0 flex-1 rounded-xs border border-border bg-surface px-3 py-2 font-mono text-body text-foreground placeholder:text-muted-foreground';

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export default function AjouterSourcePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('file');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function selectFile(next: File | undefined): void {
    setError(null);
    setNotice(null);
    if (!next) return;
    if (next.size > MAX_FILE_BYTES) {
      setError('Le fichier dépasse 50 Mo.');
      setFile(null);
      return;
    }
    if (!hasAcceptedExtension(next.name)) {
      setError('Seuls les fichiers PDF et DOCX sont acceptés.');
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function handleFileSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!file) {
      setError('Choisissez un fichier PDF ou DOCX.');
      return;
    }
    setSubmitting(true);
    try {
      const document = await uploadDocument(file);
      if (document.status === 'failed') {
        setError(document.failureReason ?? "L'indexation a échoué.");
        return;
      }
      setNotice(`Source indexée (${document.status}).`);
      router.push('/sources');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Échec de l’envoi du fichier.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUrlSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Collez une adresse HTTP ou HTTPS.');
      return;
    }
    if (!isPublicHttpUrl(trimmed)) {
      setError('Seules les adresses publiques en HTTP ou HTTPS sont acceptées.');
      return;
    }
    setSubmitting(true);
    try {
      const sourceType = tab === 'video' ? 'youtube' : 'web';
      const document = await createUrlDocument({
        sourceType,
        sourceUrl: trimmed,
        title: trimmed,
      });
      if (document.status === 'failed') {
        setError(document.failureReason ?? "L'indexation a échoué.");
        return;
      }
      setNotice(`Source indexée (${document.status}).`);
      router.push('/sources');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Échec de l'ajout de l'adresse.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="ajouter-heading"
      className="flex min-h-full justify-center bg-canvas px-4 py-8"
    >
      <div className="flex w-full max-w-[500px] flex-col gap-6 rounded-sm bg-surface p-6">
        <div className="flex items-start justify-between gap-3">
          <h1 id="ajouter-heading" className="text-heading font-bold">
            Ajouter une source
          </h1>
          <Button asChild variant="outline" size="sm">
            <Link href="/sources">Retour</Link>
          </Button>
        </div>

        <div role="tablist" aria-label="Type de source" className="flex">
          <TabButton active={tab === 'file'} onClick={() => setTab('file')} first>
            Fichier
          </TabButton>
          <TabButton active={tab === 'web'} onClick={() => setTab('web')}>
            Page web
          </TabButton>
          <TabButton active={tab === 'video'} onClick={() => setTab('video')} last>
            Vidéo
          </TabButton>
        </div>

        {tab === 'file' ? (
          <form className="flex flex-col gap-4" onSubmit={handleFileSubmit}>
            <div
              className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-border px-4 py-8 text-center"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                selectFile(event.dataTransfer.files[0]);
              }}
            >
              <FileUp className="size-11 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <p className="text-body font-semibold">{file?.name ?? 'Déposez un fichier ici'}</p>
              <p className="text-caption text-muted-foreground">
                PDF ou DOCX — 50 Mo maximum par fichier
              </p>
              <input
                ref={fileInputRef}
                id="source-file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
                aria-label="Fichier PDF ou DOCX à indexer"
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
              <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                Parcourir
              </Button>
            </div>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Indexation…' : 'Ajouter'}
            </Button>
          </form>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={handleUrlSubmit}>
            <label htmlFor="source-url" className="text-caption font-semibold">
              {tab === 'web' ? 'Adresse de la page' : 'Adresse de la vidéo'}
            </label>
            <div className="flex gap-2">
              <input
                id="source-url"
                name="source-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className={inputClass}
              />
              <Button type="submit" disabled={submitting}>
                {submitting ? '…' : 'Ajouter'}
              </Button>
            </div>
            <p className="text-caption text-muted-foreground">
              Seules les adresses publiques en HTTP ou HTTPS sont acceptées
            </p>
          </form>
        )}

        {error ? (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-caption text-muted-foreground">
            {notice}
          </p>
        ) : null}

        <div className="rounded-sm border border-border bg-canvas p-3">
          <p className="mb-2 text-caption font-semibold">Consommation</p>
          <QuotaBar
            used={FIXTURE_QUOTAS.pages.used}
            max={FIXTURE_QUOTAS.pages.max}
            unit="pages indexées"
          />
        </div>
      </div>
    </section>
  );
}

function TabButton({
  children,
  active,
  onClick,
  first,
  last,
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const radius = first ? 'rounded-l-sm' : last ? 'rounded-r-sm' : 'rounded-none';
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'flex-1 border border-border px-3 py-2 text-caption font-semibold',
        radius,
        first ? '' : '-ml-px',
        active
          ? 'relative z-10 border-b-surface bg-surface text-foreground'
          : 'bg-canvas text-muted-foreground hover:bg-selected',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
