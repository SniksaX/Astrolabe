import { SidebarNav } from '@/components/shell/sidebar-nav';

/**
 * Barre latérale de bureau (wireframes écrans 03/05/08/10/11). Cachée sous
 * 720 px au profit du panneau escamotable (`MobileNav`, écran 12).
 */
export function DesktopSidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-canvas p-4 min-[721px]:flex">
      <SidebarNav />
    </aside>
  );
}
