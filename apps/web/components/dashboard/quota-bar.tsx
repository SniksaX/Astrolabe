import type { ReactNode } from 'react';

/**
 * Barre de quota (wireframes 04/08/11) : ratio visuel + libellé numérique.
 * Le pourcentage est dérivé de used/max ; jamais de la couleur seule
 * (WCAG 1.4.1 — le chiffre reste toujours affiché à côté).
 */
export function QuotaBar({
  label,
  used,
  max,
  unit,
  showValue = true,
}: {
  label?: string;
  used: number;
  max: number;
  unit?: string;
  showValue?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  const valueLabel = unit ? `${used} / ${max} ${unit}` : `${used} / ${max}`;

  return (
    <div className="flex items-center gap-2">
      {label ? (
        <span className="w-[110px] shrink-0 text-caption text-muted-foreground">{label}</span>
      ) : null}
      <div
        className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ? `${label} : ${valueLabel}` : valueLabel}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      {showValue ? (
        <span className="shrink-0 text-caption text-muted-foreground">{valueLabel}</span>
      ) : null}
    </div>
  );
}

export function StatusChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const toneClass =
    tone === 'success'
      ? 'border-success/40 text-success'
      : tone === 'warning'
        ? 'border-warning/40 text-warning'
        : 'border-border text-muted-foreground';

  return (
    <span className={`rounded-full border px-2.5 py-1 text-caption font-semibold ${toneClass}`}>
      {children}
    </span>
  );
}
