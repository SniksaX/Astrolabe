'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { SidebarNav } from '@/components/shell/sidebar-nav';

/**
 * Barre latérale devenue menu escamotable sous 720 px (wireframe écran 12,
 * zone A). `Sheet` s'appuie sur `Dialog` de Radix : piège de focus,
 * fermeture par Échap et restitution du focus sont gérés par la primitive,
 * pas réimplémentés ici (voir docs/adr/0005).
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="min-[721px]:hidden"
          aria-label="Ouvrir la navigation"
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-3/4 p-4">
        <SheetHeader className="p-0">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
