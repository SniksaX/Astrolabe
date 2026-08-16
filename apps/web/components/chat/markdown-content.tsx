'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Renders assistant markdown with charte-aligned typography. */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-body text-left text-body [&_a]:text-accent [&_a]:underline-offset-2 hover:[&_a]:underline [&_code]:rounded-sm [&_code]:bg-canvas [&_code]:px-1 [&_code]:font-mono [&_code]:text-caption [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:bg-canvas [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-caption [&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_h1]:mb-2 [&_h1]:text-heading [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-subtitle [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:text-body [&_h3]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
