'use client';

import { use } from 'react';
import { ChatView } from '@/components/chat/chat-view';

/**
 * Optional catch-all so /chat and /chat/:id share the same page module.
 * Soft URL updates after the first message do not remount ChatView (keeps
 * Étapes / Raisonnement / Sources in memory).
 */
export default function ChatPage({
  params,
}: {
  params: Promise<{ conversationId?: string[] }>;
}) {
  const resolved = use(params);
  const conversationId = resolved.conversationId?.[0] ?? null;
  return <ChatView conversationId={conversationId} />;
}
