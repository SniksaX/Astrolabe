import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Block } from '@astrolabe/shared-types';
import { ExtractionError } from './errors.js';

// A line is a heading candidate once its font size clears the page's median
// body size by this ratio; a further 1.3x above that threshold is treated
// as level 1 rather than level 2. Heuristic (ADR 0006) — PDFs carry no
// semantic heading markup, relative font size is what's actually available.
const HEADING_SIZE_RATIO = 1.15;
const LEVEL_1_SIZE_RATIO = 1.3;
// Items are grouped into the same line when their baseline y differs by
// less than this, absorbing pdfjs-dist's per-glyph rounding.
const LINE_Y_TOLERANCE = 2;

interface PdfLine {
  page: number;
  text: string;
  fontSize: number;
}

/** pdfjs `warn()` prints via console.log(`Warning: …`) — mute TT font chatter. */
function withMutedPdfjsWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const mute = (...args: unknown[]): boolean => {
    const first = args[0];
    return typeof first === 'string' && (first.startsWith('Warning: TT:') || first.includes('TT:'));
  };
  console.log = (...args: unknown[]) => {
    if (mute(...args)) return;
    originalLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (mute(...args)) return;
    originalWarn(...args);
  };
  return fn().finally(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });
}

async function extractLines(data: Uint8Array): Promise<PdfLine[]> {
  return withMutedPdfjsWarnings(async () => {
    const doc = await getDocument({
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      verbosity: VerbosityLevel.ERRORS,
    }).promise;
    const lines: PdfLine[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      let currentY: number | null = null;
      let currentText = '';
      let currentSize = 0;
      const flush = (): void => {
        const trimmed = currentText.trim();
        if (trimmed.length > 0) lines.push({ page: pageNumber, text: trimmed, fontSize: currentSize });
        currentText = '';
        currentSize = 0;
      };

      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] ?? 0;
        const size = Math.abs(item.transform[3] ?? 0);
        if (currentY === null || Math.abs(y - currentY) > LINE_Y_TOLERANCE) {
          flush();
          currentY = y;
        }
        currentText += item.str;
        currentSize = Math.max(currentSize, size);
      }
      flush();
    }

    return lines;
  });
}

function medianFontSize(lines: readonly PdfLine[]): number {
  const sizes = [...lines.map((line) => line.fontSize)].sort((a, b) => a - b);
  const mid = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 0 ? ((sizes[mid - 1] ?? 0) + (sizes[mid] ?? 0)) / 2 : (sizes[mid] ?? 0);
}

/** PDF extractor (ADR 0006): text + font size per line via pdfjs-dist, headings deduced from relative size. Throws ExtractionError('pdf_no_text_layer') for scanned/image-only PDFs. */
export async function extractPdf(data: Uint8Array): Promise<Block[]> {
  const lines = (await extractLines(data)).filter((line) => line.text.length > 0);
  if (lines.length === 0) {
    throw new ExtractionError('pdf_no_text_layer', 'PDF has no extractable text layer (likely a scanned image)');
  }

  const bodySize = medianFontSize(lines);
  const headingThreshold = bodySize * HEADING_SIZE_RATIO;

  return lines.map((line): Block => {
    const isHeading = headingThreshold > 0 && line.fontSize >= headingThreshold;
    return {
      kind: isHeading ? 'heading' : 'paragraph',
      ...(isHeading ? { level: line.fontSize >= bodySize * LEVEL_1_SIZE_RATIO ? 1 : 2 } : {}),
      text: line.text,
      locator: { page: line.page },
    };
  });
}
