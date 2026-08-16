'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FileText, Globe, Info, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/dashboard/quota-bar';
import { ApiError, deleteDocument, listDocuments, type DocumentDto } from '@/lib/api';
import { FIXTURE_QUOTAS } from '@/lib/dashboard-fixtures';

function SourceIcon({ sourceType }: { sourceType: DocumentDto['sourceType'] }) {
  const className = 'size-5 shrink-0 text-muted-foreground';
  if (sourceType === 'youtube') return <Video className={className} aria-hidden />;
  if (sourceType === 'web') return <Globe className={className} aria-hidden />;
  return <FileText className={className} aria-hidden />;
}

function statusLabel(status: DocumentDto['status']): string {
  switch (status) {
    case 'ready':
      return 'Indexé';
    case 'processing':
    case 'pending':
      return 'En cours';
    case 'failed':
      return 'Échec';
  }
}

function statusTone(status: DocumentDto['status']): 'success' | 'neutral' | 'warning' {
  if (status === 'ready') return 'success';
  if (status === 'failed') return 'warning';
  return 'neutral';
}

function typeLabel(doc: DocumentDto): string {
  if (doc.sourceType === 'pdf') return 'Document PDF/DOCX';
  if (doc.sourceType === 'web') return 'Page web';
  if (doc.sourceType === 'youtube') return 'Vidéo';
  return 'Texte';
}

export default function SourcesPage() {
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await listDocuments());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de charger les sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDelete(id: string): Promise<void> {
    try {
      await deleteDocument(id);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    }
  }

  const readyCount = documents.filter((doc) => doc.status === 'ready').length;
  const failed = documents.filter((doc) => doc.status === 'failed');

  return (
    <section aria-labelledby="sources-heading" className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="sources-heading" className="text-heading font-bold">
          Sources
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className="text-caption text-muted-foreground">
            {readyCount} / {FIXTURE_QUOTAS.sources.max} sources
          </span>
          <Button asChild size="sm">
            <Link href="/sources/ajouter">Ajouter une source</Link>
          </Button>
        </div>
      </div>

      {loading ? <p className="text-caption text-muted-foreground">Chargement…</p> : null}

      {!loading && documents.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border p-8 text-center">
          <p className="text-body font-semibold">Aucune source pour l’instant</p>
          <p className="mt-1 text-caption text-muted-foreground">
            Ajoutez un PDF, une page web ou une vidéo pour commencer.
          </p>
          <Button asChild className="mt-4">
            <Link href="/sources/ajouter">Ajouter une source</Link>
          </Button>
        </div>
      ) : null}

      {documents.length > 0 ? (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {documents
            .filter((doc) => doc.status !== 'failed')
            .map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 p-4">
                <SourceIcon sourceType={doc.sourceType} />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-body font-semibold">{doc.title}</p>
                  <p className="text-caption text-muted-foreground">{typeLabel(doc)}</p>
                </div>
                <StatusChip tone={statusTone(doc.status)}>{statusLabel(doc.status)}</StatusChip>
                <Button type="button" variant="outline" size="sm" onClick={() => void handleDelete(doc.id)}>
                  Supprimer
                </Button>
              </li>
            ))}
        </ul>
      ) : null}

      {failed.map((doc) => (
        <div
          key={doc.id}
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-sm border border-warning/30 bg-warning-bg p-4"
        >
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-caption font-semibold text-warning">{doc.title}</p>
            <p className="text-caption text-muted-foreground">
              {doc.failureReason ?? "Cette source n'a pas pu être indexée."}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleDelete(doc.id)}>
            Retirer
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 rounded-sm border border-border p-3">
        <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-caption text-muted-foreground">
          Enrichissement contextuel désactivé sur l&apos;offre découverte — améliore la pertinence,
          augmente le coût d&apos;indexation
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/offre">En savoir plus</Link>
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-caption text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
