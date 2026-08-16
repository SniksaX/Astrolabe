import type { LucideIcon } from 'lucide-react';
import { CreditCard, Files, Settings } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Entrées de navigation basses de la barre latérale (wireframes écrans
 * 03/05/08/10/11). Source unique, partagée entre la barre latérale de
 * bureau et le panneau de navigation mobile.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: '/sources', label: 'Sources', icon: Files },
  { href: '/reglages', label: 'Réglages', icon: Settings },
  { href: '/offre', label: 'Offre', icon: CreditCard },
];
