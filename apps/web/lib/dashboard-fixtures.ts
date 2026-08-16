/**
 * Contenu illustratif des écrans 08/11 tant que ingestion / billing /
 * usage_counters ne sont pas câblés. Même logique que le bandeau d'état
 * (quotas figés) : présentation fidèle aux wireframes, pas une donnée réelle.
 */

export type SourceListItem = {
  id: string;
  title: string;
  detail: string;
  status: 'indexed' | 'processing' | 'failed';
  progressPct?: number;
  action: 'delete' | 'suspend' | 'remove';
};

export const FIXTURE_SOURCES: SourceListItem[] = [
  {
    id: 'pdf-1',
    title: 'Cahier des charges v2.0.pdf',
    detail: 'Document PDF — 128 pages, 342 fragments',
    status: 'indexed',
    action: 'delete',
  },
  {
    id: 'yt-1',
    title: 'Conférence — introduction au RAG',
    detail: 'Vidéo — transcription en cours, 24 min sur 52',
    status: 'processing',
    progressPct: 46,
    action: 'suspend',
  },
  {
    id: 'web-1',
    title: 'Documentation PostgreSQL — row security',
    detail: 'Page web — 18 fragments',
    status: 'indexed',
    action: 'delete',
  },
];

export const FIXTURE_FAILED_SOURCE = {
  id: 'yt-fail',
  title: 'Vidéo — sous-titres indisponibles',
  detail:
    "Cette vidéo ne fournit pas de transcription exploitable. La source n'a pas été indexée.",
};

export const FIXTURE_QUOTAS = {
  questions: { used: 18, max: 50 },
  sources: { used: 3, max: 5 },
  pages: { used: 24, max: 200 },
  plan: 'découverte' as const,
};
