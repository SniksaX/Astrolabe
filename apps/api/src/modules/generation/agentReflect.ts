import { inferenceClient } from '@astrolabe/inference';
import type { ChatMessage } from '@astrolabe/shared-types';

export interface AgenticReflection {
  sufficient: boolean;
  needsClarification: boolean;
  clarifyingQuestion: string | null;
  /** Concrete choices for the UI (excluding the free-text « Autre »). */
  options: string[];
  critique: string;
  reasoning: string;
  queries: string[];
  webQuery: string | null;
}

function extractJsonObject(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function formatHistory(history: ChatMessage[]): string {
  const recent = history.slice(-6);
  if (recent.length === 0) return '(aucun historique)';
  return recent.map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join('\n');
}

/**
 * Asks the model whether current RAG/web excerpts answer the question,
 * whether the user must clarify, and which follow-up queries to run.
 * Thinking is OFF — reflection must stay compact JSON (context budget).
 * Fail-open → sufficient when the model is unreachable.
 */
export async function reflectOnContext(input: {
  question: string;
  history: ChatMessage[];
  contextDigest: string;
  /** When true, history topic and web hits likely disagree — must clarify if vague. */
  topicMismatchHint?: boolean;
  historyTopic?: string | null;
}): Promise<AgenticReflection> {
  const mismatchHint = input.topicMismatchHint
    ? ` ALERTE: le sujet historique (« ${input.historyTopic ?? '?'} ») et les résultats web ` +
      `semblent parler de choses différentes. Si la question est vague, ` +
      `needsClarification=true OBLIGATOIRE (ne pas mettre sufficient=true).`
    : '';

  const result = await inferenceClient.complete(
    [
      {
        role: 'system',
        content:
          'Tu es un agent de recherche. Évalue si les extraits suffisent pour répondre. ' +
          'Tiens compte de l’historique : une question vague (« comment ça marche ? ») ' +
          'renvoie au sujet précédent — sauf si le web parle d’un autre sujet (ex. site CCM vs MongoDB) : ' +
          'alors clarifie. ' +
          'Réponds UNIQUEMENT par un objet JSON:\n' +
          '{"sufficient":boolean,"needsClarification":boolean,"clarifyingQuestion":string|null,' +
          '"options":string[],"critique":string,"queries":string[],"webQuery":string|null}\n' +
          'Si needsClarification=true : clarifyingQuestion court en français ; ' +
          'options = 2 à 4 libellés courts et clairs (pas de « Autre ») ; queries=[]. ' +
          'Ne rédige JAMAIS une réponse longue : seulement la question + options. ' +
          'Si historique et web divergent sur le sujet et que la question est sous-spécifiée : ' +
          'needsClarification=true (ignore la règle « prefer sufficient »). ' +
          'Sinon, si les extraits corpus couvrent déjà (même partiellement) les facettes ' +
          'demandées pour le BON sujet, préfère sufficient=true. ' +
          'Ne propose une relance (sufficient=false, needsClarification=false) que si ' +
          'une facette clé du bon sujet est totalement absente. ' +
          'Si sufficient=false et needsClarification=false : propose 1 à 3 queries corpus ' +
          'et éventuellement webQuery ancrée sur le sujet historique. critique en français, court.' +
          mismatchHint,
      },
      {
        role: 'user',
        content:
          `Historique récent:\n${formatHistory(input.history)}\n\n` +
          `Sujet historique détecté: ${input.historyTopic ?? '(aucun)'}\n` +
          `Question actuelle: ${input.question}\n\n` +
          `Extraits disponibles:\n${input.contextDigest}\n\nJSON:`,
      },
    ],
    { maxTokens: 500, temperature: 0.2, enableThinking: false, timeoutMs: 45_000 },
  );

  const empty: AgenticReflection = {
    sufficient: true,
    needsClarification: false,
    clarifyingQuestion: null,
    options: [],
    critique: '',
    reasoning: '',
    queries: [],
    webQuery: null,
  };

  if (!result) return empty;

  const parsed = extractJsonObject(result.content);
  if (typeof parsed !== 'object' || parsed === null) {
    return { ...empty, critique: result.content.slice(0, 400) };
  }

  const body = parsed as {
    sufficient?: unknown;
    needsClarification?: unknown;
    clarifyingQuestion?: unknown;
    options?: unknown;
    critique?: unknown;
    queries?: unknown;
    webQuery?: unknown;
  };

  let needsClarification = body.needsClarification === true;
  // Hard override when caller already detected mismatch on a vague ask
  if (input.topicMismatchHint) {
    needsClarification = true;
  }

  const clarifyingQuestion =
    typeof body.clarifyingQuestion === 'string' && body.clarifyingQuestion.trim()
      ? body.clarifyingQuestion.trim()
      : null;

  const options = Array.isArray(body.options)
    ? body.options
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
        .slice(0, 4)
    : [];

  const queries = Array.isArray(body.queries)
    ? body.queries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter((q) => q.length > 0)
        .slice(0, 3)
    : [];

  return {
    sufficient: needsClarification ? false : body.sufficient !== false,
    needsClarification,
    clarifyingQuestion,
    options: needsClarification ? options : [],
    critique: typeof body.critique === 'string' ? body.critique : '',
    reasoning: '',
    queries: needsClarification ? [] : queries,
    webQuery:
      needsClarification || typeof body.webQuery !== 'string' || !body.webQuery.trim()
        ? null
        : body.webQuery.trim(),
  };
}
