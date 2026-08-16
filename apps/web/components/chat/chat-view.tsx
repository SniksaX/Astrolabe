'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileStack, Globe, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversations } from '@/components/shell/conversations-context';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  ApiError,
  getConversation,
  listDocuments,
  patchConversationSettings,
  streamChat,
  type ChatStreamEvent,
  type DocumentDto,
} from '@/lib/api';
import { MarkdownContent } from '@/components/chat/markdown-content';

type EffortTier = 'low' | 'medium' | 'high';

type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  activity?: string[];
  citations?: { documentTitle: string; snippet: string; url?: string }[];
  clarification?: { question: string; options: string[] };
};

type ChatGenConfig = {
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatPenalty: number;
  maxTokens: number;
  retrievalTopK: number;
};

const EFFORT_DEFAULTS: Record<EffortTier, Pick<ChatGenConfig, 'maxTokens' | 'retrievalTopK'>> = {
  low: { maxTokens: 512, retrievalTopK: 5 },
  medium: { maxTokens: 1024, retrievalTopK: 10 },
  high: { maxTokens: 1536, retrievalTopK: 10 },
};

const DEFAULT_GEN: ChatGenConfig = {
  temperature: 0.2,
  topK: 40,
  topP: 0.95,
  minP: 0.05,
  repeatPenalty: 1.1,
  ...EFFORT_DEFAULTS.medium,
};

function ConfigSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? 'opacity-50' : undefined}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-caption font-semibold text-foreground">
          {label}
        </label>
        <span className="font-mono text-caption text-muted-foreground">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}


function applyConversationSettings(
  settings: {
    effort?: EffortTier;
    thinking?: boolean;
    webSearch?: boolean;
    useRag?: boolean;
    ragWeight?: number;
    generation?: Partial<ChatGenConfig>;
  } | undefined,
  setters: {
    setEffort: (e: EffortTier) => void;
    setThinkingEnabled: (v: boolean) => void;
    setWebSearchEnabled: (v: boolean) => void;
    setRagEnabled: (v: boolean) => void;
    setRagWeight: (v: number) => void;
    setGenConfig: (updater: (prev: ChatGenConfig) => ChatGenConfig) => void;
  },
): void {
  if (!settings) return;
  const effort = settings.effort ?? 'medium';
  setters.setEffort(effort);
  setters.setThinkingEnabled(settings.thinking === true);
  setters.setWebSearchEnabled(settings.webSearch === true);
  setters.setRagEnabled(settings.useRag !== false);
  if (typeof settings.ragWeight === 'number') setters.setRagWeight(settings.ragWeight);
  setters.setGenConfig((prev) => ({
    ...prev,
    ...EFFORT_DEFAULTS[effort],
    ...(settings.generation ?? {}),
  }));
}

export function ChatView({ conversationId = null }: { conversationId?: string | null }) {
  const router = useRouter();
  const { refresh: refreshConversations } = useConversations();
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversationId,
  );
  const [loadingConversation, setLoadingConversation] = useState(Boolean(conversationId));
  const [streaming, setStreaming] = useState(false);
  const [pipelineStatus, setPipelineStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [effort, setEffort] = useState<EffortTier>('medium');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [genConfig, setGenConfig] = useState<ChatGenConfig>(DEFAULT_GEN);
  /** RAG share when both channels on; web = 1 - ragWeight. */
  const [ragWeight, setRagWeight] = useState(0.6);
  const [otherDraft, setOtherDraft] = useState('');
  /** After first answer, URL updates without discarding in-memory turns. */
  const skipNextLoadRef = useRef(false);
  const settingsReadyRef = useRef(false);
  const loadedConversationRef = useRef<string | null>(null);

  useEffect(() => {
    void listDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, []);

  useEffect(() => {
    if (!conversationId) {
      // Navigated to blank /chat (nouvelle conversation).
      setActiveConversationId(null);
      setTurns([]);
      setLoadingConversation(false);
      setError(null);
      loadedConversationRef.current = null;
      settingsReadyRef.current = false;
      return;
    }

    if (skipNextLoadRef.current) {
      skipNextLoadRef.current = false;
      setActiveConversationId(conversationId);
      setLoadingConversation(false);
      loadedConversationRef.current = conversationId;
      settingsReadyRef.current = true;
      return;
    }

    if (loadedConversationRef.current === conversationId && turns.length > 0) {
      setActiveConversationId(conversationId);
      setLoadingConversation(false);
      return;
    }

    let cancelled = false;
    setActiveConversationId(conversationId);
    setLoadingConversation(true);
    setError(null);
    settingsReadyRef.current = false;
    void getConversation(conversationId)
      .then((detail) => {
        if (cancelled) return;
        setTurns(
          detail.messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            ...(msg.reasoning ? { reasoning: msg.reasoning } : {}),
            ...(msg.activity && msg.activity.length > 0 ? { activity: msg.activity } : {}),
            ...(msg.citations && msg.citations.length > 0 ? { citations: msg.citations } : {}),
            ...(msg.clarification ? { clarification: msg.clarification } : {}),
          })),
        );
        applyConversationSettings(detail.conversation.settings, {
          setEffort,
          setThinkingEnabled,
          setWebSearchEnabled,
          setRagEnabled,
          setRagWeight,
          setGenConfig,
        });
        loadedConversationRef.current = conversationId;
        queueMicrotask(() => {
          settingsReadyRef.current = true;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setError('Conversation introuvable.');
        setTurns([]);
        loadedConversationRef.current = null;
      })
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reload when route id changes
  }, [conversationId]);

  useEffect(() => {
    const id = activeConversationId ?? conversationId;
    if (!id || !settingsReadyRef.current || streaming) return;
    const timer = window.setTimeout(() => {
      void patchConversationSettings(id, {
        effort,
        thinking: thinkingEnabled,
        webSearch: webSearchEnabled,
        useRag: ragEnabled,
        ragWeight,
        generation: { ...genConfig },
      }).catch(() => {
        /* fail-open */
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    activeConversationId,
    conversationId,
    effort,
    thinkingEnabled,
    webSearchEnabled,
    ragEnabled,
    ragWeight,
    genConfig,
    streaming,
  ]);

  function selectEffort(next: EffortTier): void {
    setEffort(next);
    setGenConfig((prev) => ({ ...prev, ...EFFORT_DEFAULTS[next] }));
    if (next === 'low') setThinkingEnabled(false);
  }

  const readyCount = documents?.filter((doc) => doc.status === 'ready').length ?? 0;
  const canAsk =
    (webSearchEnabled || (ragEnabled && readyCount > 0)) && (ragEnabled || webSearchEnabled);
  const showEmpty =
    !conversationId &&
    !activeConversationId &&
    documents !== null &&
    readyCount === 0 &&
    turns.length === 0 &&
    !webSearchEnabled &&
    !loadingConversation;

  async function sendMessage(text: string): Promise<void> {
    if (!text || streaming || !canAsk) return;
    setError(null);
    setMessage('');
    setPipelineStatus('Préparation…');
    setTurns((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    setStreaming(true);

    let assistant = '';
    let reasoning = '';
    let activity: string[] = [];
    let citations: ChatTurn['citations'] = [];
    let clarification: ChatTurn['clarification'];
    let ensuredId = activeConversationId;

    const patchAssistant = (): void => {
      const snapshot = assistant;
      const reasonSnap = reasoning;
      const activitySnap = activity;
      const cites = citations;
      const clarifySnap = clarification;
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: 'assistant',
          content: snapshot,
          ...(reasonSnap ? { reasoning: reasonSnap } : {}),
          ...(activitySnap.length > 0 ? { activity: activitySnap } : {}),
          ...(cites && cites.length > 0 ? { citations: cites } : {}),
          ...(clarifySnap ? { clarification: clarifySnap } : {}),
        };
        return next;
      });
    };

    try {
      await streamChat(
        text,
        (event: ChatStreamEvent) => {
          if (event.kind === 'conversation') {
            ensuredId = event.conversationId;
            setActiveConversationId(event.conversationId);
            loadedConversationRef.current = event.conversationId;
            settingsReadyRef.current = true;
            void refreshConversations();
          } else if (event.kind === 'status') {
            setPipelineStatus(event.label);
            activity = [...activity, event.label];
            patchAssistant();
          } else if (event.kind === 'clarification') {
            clarification = { question: event.question, options: event.options };
            setOtherDraft('');
            patchAssistant();
          } else if (event.kind === 'citations') {
            citations = event.citations.map((citation) => ({
              documentTitle: citation.documentTitle,
              snippet: citation.snippet,
              ...(citation.url ? { url: citation.url } : {}),
            }));
            patchAssistant();
          } else if (event.kind === 'reasoning') {
            reasoning += event.delta;
            patchAssistant();
          } else if (event.kind === 'content') {
            if (!clarification) {
              assistant += event.delta;
              patchAssistant();
            }
          } else if (event.kind === 'error') {
            setError(event.message);
          }
        },
        {
          ...(ensuredId ? { conversationId: ensuredId } : {}),
          effort,
          ...(effort !== 'low' && thinkingEnabled ? { thinking: true } : {}),
          ...(webSearchEnabled ? { webSearch: true } : {}),
          ...(ragEnabled ? {} : { useRag: false }),
          generation: { ...genConfig },
          ...(ragEnabled && webSearchEnabled
            ? { sourceWeights: { rag: ragWeight, web: 1 - ragWeight } }
            : {}),
        },
      );
      void refreshConversations();
      if (!conversationId && ensuredId) {
        skipNextLoadRef.current = true;
        router.replace(`/chat/${ensuredId}`, { scroll: false });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La génération a échoué.');
    } finally {
      setStreaming(false);
      setPipelineStatus(null);
    }
  }

  async function handleAsk(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await sendMessage(message.trim());
  }

  async function chooseClarification(option: string): Promise<void> {
    await sendMessage(option);
  }

  if (loadingConversation) {
    return (
      <section className="flex h-full items-center justify-center px-6">
        <p className="text-caption text-muted-foreground">Chargement de la conversation…</p>
      </section>
    );
  }

  if (showEmpty) {
    return (
      <section
        aria-labelledby="chat-heading"
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <FileStack className="size-14 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <h1 id="chat-heading" className="text-heading font-bold">
          Ajoutez votre première source
        </h1>
        <p className="max-w-[320px] text-body text-muted-foreground">
          Astrolabe répond à vos questions à partir des documents que vous ajoutez, chaque réponse
          appuyée sur ses sources.
        </p>
        <Button asChild className="mt-1.5">
          <Link href="/sources/ajouter">Ajouter ma première source</Link>
        </Button>
        <span className="text-caption text-muted-foreground">Un PDF, une page web ou une vidéo</span>
        <button
          type="button"
          onClick={() => {
            setWebSearchEnabled(true);
            setRagEnabled(false);
          }}
          className="mt-4 text-caption font-semibold text-accent underline-offset-2 hover:underline"
        >
          Ou activer la recherche web sans source
        </button>
      </section>
    );
  }

  const placeholder =
    ragEnabled && webSearchEnabled
      ? 'Posez une question (sources + web)…'
      : webSearchEnabled
        ? 'Posez une question sur le web…'
        : 'Posez une question sur vos sources…';

  const effortLabel =
    effort === 'low' ? 'Faible' : effort === 'medium' ? 'Moyen' : 'Élevé';

  return (
    <section aria-labelledby="chat-heading" className="flex h-full flex-col">
      <div className="border-b border-border px-6 py-4">
        <h1 id="chat-heading" className="text-heading font-bold">
          Conversation
        </h1>
        <p className="text-caption text-muted-foreground">
          Effort {effortLabel}
          {effort !== 'low' && thinkingEnabled ? ' · thinking' : ''}
          {effort === 'high' ? ' · agentique' : ''}
          {' · '}
          {ragEnabled
            ? `${readyCount} source${readyCount > 1 ? 's' : ''} prête${readyCount > 1 ? 's' : ''}`
            : 'RAG désactivé'}
          {webSearchEnabled ? ' · recherche web activée' : ''}
          {ragEnabled && webSearchEnabled
            ? ` · poids ${Math.round(ragWeight * 100)}/${Math.round((1 - ragWeight) * 100)}`
            : ''}
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {turns.map((turn, index) => (
          <div
            key={`${turn.role}-${index}`}
            className={turn.role === 'user' ? 'ml-auto max-w-[80%] text-right' : 'max-w-[90%]'}
          >
            {turn.role === 'assistant' &&
            (turn.activity?.length || turn.reasoning || turn.citations?.length) ? (
              <div className="mb-2 flex flex-wrap gap-2 text-left">
                {turn.activity && turn.activity.length > 0 ? (
                  <details className="min-w-[12rem] flex-1 rounded-sm border border-border bg-canvas px-2 py-1.5">
                    <summary className="cursor-pointer text-caption font-semibold text-muted-foreground">
                      Étapes
                    </summary>
                    <ul className="mt-1 list-inside list-disc text-caption text-muted-foreground">
                      {turn.activity.map((step, stepIndex) => (
                        <li key={`${step}-${stepIndex}`}>{step}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {turn.reasoning ? (
                  <details className="min-w-[12rem] flex-1 rounded-sm border border-border bg-canvas px-2 py-1.5">
                    <summary className="cursor-pointer text-caption font-semibold text-muted-foreground">
                      Raisonnement
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-caption text-muted-foreground">
                      {turn.reasoning}
                    </pre>
                  </details>
                ) : null}
                {turn.citations && turn.citations.length > 0 ? (
                  <details className="min-w-[12rem] flex-1 rounded-sm border border-border bg-canvas px-2 py-1.5">
                    <summary className="cursor-pointer text-caption font-semibold text-muted-foreground">
                      Sources ({turn.citations.length})
                    </summary>
                    <ul className="mt-1 space-y-1">
                      {turn.citations.map((citation, citationIndex) => (
                        <li
                          key={`${citation.documentTitle}-${citationIndex}`}
                          className="text-caption text-muted-foreground"
                        >
                          <span className="font-semibold text-foreground">
                            [{citationIndex + 1}] {citation.documentTitle}
                          </span>
                          {citation.url ? (
                            <>
                              {' — '}
                              <a
                                href={citation.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent underline-offset-2 hover:underline"
                              >
                                lien
                              </a>
                            </>
                          ) : null}
                          {' — '}
                          {citation.snippet.slice(0, 120)}
                          {citation.snippet.length > 120 ? '…' : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            {turn.role === 'assistant' && turn.clarification ? (
              <div className="rounded-md border border-border bg-surface px-3 py-3 text-left">
                <p className="mb-3 text-body font-semibold">{turn.clarification.question}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {turn.clarification.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={streaming}
                      onClick={() => void chooseClarification(option)}
                      className="rounded-sm border border-border bg-canvas px-3 py-2.5 text-left text-caption font-semibold text-foreground hover:border-accent hover:bg-selected disabled:opacity-50"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={index === turns.length - 1 ? otherDraft : ''}
                    onChange={(event) => setOtherDraft(event.target.value)}
                    disabled={streaming || index !== turns.length - 1}
                    placeholder="Autre…"
                    className="min-w-0 flex-1 rounded-xs border border-border bg-surface px-3 py-2 text-caption"
                    aria-label="Autre précision"
                  />
                  <Button
                    type="button"
                    disabled={
                      streaming || index !== turns.length - 1 || !otherDraft.trim()
                    }
                    onClick={() => void chooseClarification(otherDraft.trim())}
                  >
                    Envoyer
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className={
                  turn.role === 'user'
                    ? 'inline-block rounded-md bg-selected px-3 py-2 text-body'
                    : 'rounded-md border border-border bg-surface px-3 py-2 text-body'
                }
              >
                {turn.role === 'assistant' ? (
                  turn.content ? (
                    <MarkdownContent content={turn.content} />
                  ) : streaming && index === turns.length - 1 ? (
                    <span className="text-muted-foreground">
                      {pipelineStatus ?? 'Préparation…'}
                    </span>
                  ) : null
                ) : (
                  turn.content
                )}
              </div>
            )}
            {streaming && index === turns.length - 1 && turn.content && !turn.clarification ? (
              <p className="mt-1 text-left text-caption text-muted-foreground" aria-live="polite">
                {pipelineStatus}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <form onSubmit={handleAsk} className="border-t border-border p-4">
        <label htmlFor="chat-input" className="sr-only">
          Votre question
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Paramètres de génération"
            aria-expanded={configOpen}
            onClick={() => setConfigOpen(true)}
            className="shrink-0"
          >
            <Settings2 className="size-4" aria-hidden />
          </Button>
          <input
            id="chat-input"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={placeholder}
            disabled={streaming || !canAsk}
            className="min-w-0 flex-1 rounded-xs border border-border bg-surface px-3 py-2 text-body"
          />
          <Button type="submit" disabled={streaming || !canAsk || !message.trim()}>
            {streaming ? '…' : 'Envoyer'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={ragEnabled}
            aria-label="Documents RAG"
            onClick={() => setRagEnabled((prev) => !prev)}
            className={[
              'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-caption font-semibold',
              ragEnabled
                ? 'border-accent bg-selected text-foreground'
                : 'border-border bg-surface text-muted-foreground hover:bg-selected/60',
            ].join(' ')}
          >
            <FileStack className="size-3.5" aria-hidden />
            Documents
            <span className="text-caption font-normal opacity-80">
              {ragEnabled ? 'activés' : 'désactivés'}
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={webSearchEnabled}
            aria-label="Recherche web"
            onClick={() => setWebSearchEnabled((prev) => !prev)}
            className={[
              'inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-caption font-semibold',
              webSearchEnabled
                ? 'border-accent bg-selected text-foreground'
                : 'border-border bg-surface text-muted-foreground hover:bg-selected/60',
            ].join(' ')}
          >
            <Globe className="size-3.5" aria-hidden />
            Recherche web
            <span className="text-caption font-normal opacity-80">
              {webSearchEnabled ? 'activée' : 'désactivée'}
            </span>
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-caption text-danger">
            {error}
          </p>
        ) : null}
      </form>

      <Sheet open={configOpen} onOpenChange={setConfigOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Paramètres du modèle</SheetTitle>
            <SheetDescription>
              Effort, thinking, réglages llama.cpp (Qwen) et pondération des sources.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6">
            <div>
              <p className="mb-2 text-caption font-semibold text-foreground">Effort</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Niveau d’effort">
                {(
                  [
                    { id: 'low' as const, label: 'Faible', hint: 'Réponse directe' },
                    { id: 'medium' as const, label: 'Moyen', hint: 'Plus de contexte' },
                    { id: 'high' as const, label: 'Élevé', hint: 'Agentique' },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={effort === option.id}
                    onClick={() => selectEffort(option.id)}
                    className={[
                      'rounded-sm border px-2 py-2 text-left',
                      effort === option.id
                        ? 'border-accent bg-selected text-foreground'
                        : 'border-border bg-surface text-muted-foreground hover:bg-selected/60',
                    ].join(' ')}
                  >
                    <span className="block text-caption font-semibold">{option.label}</span>
                    <span className="block text-caption opacity-80">{option.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-caption text-muted-foreground">
                {effort === 'low'
                  ? 'Contexte réduit, pas de thinking — réponse à partir des sources choisies.'
                  : effort === 'medium'
                    ? 'Contexte élargi et décomposition de la question. Thinking optionnel ci-dessous.'
                    : 'Contexte maximal, boucle agentique (évaluation / clarification / relance). Thinking optionnel.'}
              </p>
            </div>

            <label
              className={[
                'flex items-start gap-2 rounded-sm border border-border px-3 py-2',
                effort === 'low' ? 'bg-canvas opacity-60' : 'bg-surface',
              ].join(' ')}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={effort === 'low' ? false : thinkingEnabled}
                disabled={effort === 'low'}
                onChange={(event) => setThinkingEnabled(event.target.checked)}
              />
              <span>
                <span className="block text-caption font-semibold text-foreground">Thinking</span>
                <span className="block text-caption text-muted-foreground">
                  {effort === 'low'
                    ? 'Désactivé en effort Faible.'
                    : 'Affiche un raisonnement court du modèle (séparé des étapes agent).'}
                </span>
              </span>
            </label>

            <ConfigSlider
              id="cfg-temperature"
              label="Temperature"
              value={genConfig.temperature}
              min={0}
              max={2}
              step={0.05}
              display={genConfig.temperature.toFixed(2)}
              onChange={(temperature) => setGenConfig((prev) => ({ ...prev, temperature }))}
            />
            <ConfigSlider
              id="cfg-top-k"
              label="Top-k"
              value={genConfig.topK}
              min={0}
              max={100}
              step={1}
              display={String(genConfig.topK)}
              onChange={(topK) => setGenConfig((prev) => ({ ...prev, topK }))}
            />
            <ConfigSlider
              id="cfg-top-p"
              label="Top-p"
              value={genConfig.topP}
              min={0}
              max={1}
              step={0.01}
              display={genConfig.topP.toFixed(2)}
              onChange={(topP) => setGenConfig((prev) => ({ ...prev, topP }))}
            />
            <ConfigSlider
              id="cfg-min-p"
              label="Min-p"
              value={genConfig.minP}
              min={0}
              max={1}
              step={0.01}
              display={genConfig.minP.toFixed(2)}
              onChange={(minP) => setGenConfig((prev) => ({ ...prev, minP }))}
            />
            <ConfigSlider
              id="cfg-repeat"
              label="Repeat penalty"
              value={genConfig.repeatPenalty}
              min={0.5}
              max={2}
              step={0.05}
              display={genConfig.repeatPenalty.toFixed(2)}
              onChange={(repeatPenalty) => setGenConfig((prev) => ({ ...prev, repeatPenalty }))}
            />
            <ConfigSlider
              id="cfg-max-tokens"
              label="Max tokens"
              value={genConfig.maxTokens}
              min={64}
              max={4096}
              step={64}
              display={String(genConfig.maxTokens)}
              onChange={(maxTokens) => setGenConfig((prev) => ({ ...prev, maxTokens }))}
            />
            <ConfigSlider
              id="cfg-retrieval-topk"
              label="Retrieval top-k"
              value={genConfig.retrievalTopK}
              min={1}
              max={30}
              step={1}
              display={String(genConfig.retrievalTopK)}
              onChange={(retrievalTopK) => setGenConfig((prev) => ({ ...prev, retrievalTopK }))}
              disabled={!ragEnabled}
            />

            <div
              className={
                ragEnabled && webSearchEnabled
                  ? 'border-t border-border pt-4'
                  : 'border-t border-border pt-4 opacity-50'
              }
            >
              <p className="mb-2 text-caption font-semibold text-foreground">
                Pondération des sources
              </p>
              <p className="mb-3 text-caption text-muted-foreground">
                Disponible uniquement lorsque Documents et Recherche web sont tous deux activés.
                Un poids plus élevé indique la source de vérité préférée.
              </p>
              <ConfigSlider
                id="cfg-rag-weight"
                label="Corpus (RAG)"
                value={Math.round(ragWeight * 100)}
                min={0}
                max={100}
                step={5}
                display={`${Math.round(ragWeight * 100)} %`}
                onChange={(pct) => setRagWeight(pct / 100)}
                disabled={!(ragEnabled && webSearchEnabled)}
              />
              <div className="mt-2 flex justify-between text-caption text-muted-foreground">
                <span>Web {Math.round((1 - ragWeight) * 100)} %</span>
                <button
                  type="button"
                  className="font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-40"
                  disabled={!(ragEnabled && webSearchEnabled)}
                  onClick={() => setRagWeight(0.6)}
                >
                  Réinitialiser 60 / 40
                </button>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                setEffort('medium');
                setThinkingEnabled(false);
                setGenConfig(DEFAULT_GEN);
                setRagWeight(0.6);
              }}
            >
              Réinitialiser les paramètres
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
