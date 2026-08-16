import { inferenceClient } from '@astrolabe/inference';

/**
 * Decomposes a user question into focused retrieval sub-queries.
 * Fail-open: on any LLM failure, returns the original message alone.
 */
export interface DecompositionResult {
  subQueries: string[];
}

function extractJsonArray(text: string): unknown {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export class DecompositionService {
  async decompose(message: string, topic?: string | null): Promise<DecompositionResult> {
    const topicLine = topic ? `Sujet de conversation: ${topic}\n` : '';
    const result = await inferenceClient.complete(
      [
        {
          role: 'system',
          content:
            'Tu décomposes une question en sous-requêtes de recherche documentaire. ' +
            'Ancre chaque sous-requête sur le sujet de conversation s’il est fourni. ' +
            'Réponds uniquement par un tableau JSON de 2 à 4 chaînes en français, sans prose.',
        },
        {
          role: 'user',
          content: `${topicLine}Question: ${message}\n\nSous-requêtes JSON:`,
        },
      ],
      { maxTokens: 256, temperature: 0.1, enableThinking: false, timeoutMs: 30_000 },
    );
    if (!result?.content) return { subQueries: [message] };
    const parsed = extractJsonArray(result.content);
    if (!Array.isArray(parsed)) return { subQueries: [message] };
    const subQueries = parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 4);
    return { subQueries: subQueries.length > 0 ? subQueries : [message] };
  }
}

export const decompositionService = new DecompositionService();
