import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

/*
 * Non-régression pour le bug documenté dans docs/journal.md (2026-08-14) :
 * un second `@theme` redéclarant `--color-accent` écrasait silencieusement
 * le token de la charte, sans erreur de build — `--primary` et l'anneau de
 * focus héritaient de `selected` (#eaf0f7) au lieu de l'accent (#1F3A5F).
 * Ce risque revient à chaque composant shadcn ajouté (CLI shadcn ajoute ses
 * propres blocs `@theme`) : ce test compile le vrai pipeline Tailwind v4
 * plutôt que de relire le code source, pour détecter une collision même
 * introduite depuis un fichier tiers (ex. `shadcn/tailwind.css`).
 */

const GLOBALS_CSS = path.resolve(__dirname, "../app/globals.css");

async function compileGlobals() {
  const css = fs.readFileSync(GLOBALS_CSS, "utf8");
  // `as any` : deux copies de postcss coexistent dans l'arbre de dépendances
  // (celle de `apps/web`, celle imbriquée sous `vite`) — leurs types
  // `Plugin` divergent structurellement sous `exactOptionalPropertyTypes`,
  // sans que cela reflète un vrai problème d'exécution (vérifié : le test
  // compile et s'exécute correctement).
  const result = await postcss([tailwind()] as any).process(css, { from: GLOBALS_CSS });
  return result.css;
}

describe("anneau de focus — collision de tokens (charte §6)", () => {
  it("--color-accent de la charte (#1F3A5F) est présent dans le thème clair", async () => {
    const compiled = await compileGlobals();
    // Le thème sombre redéclare --color-accent avec une valeur plus claire ;
    // on vérifie que la valeur claire de la charte n'a pas disparu ni été
    // écrasée par « selected » (#eaf0f7) — régression du 2026-08-14.
    expect(compiled.toLowerCase()).toMatch(/--color-accent:\s*#1f3a5f/);
    expect(compiled.toLowerCase()).not.toMatch(/--color-accent:\s*#eaf0f7/);
  });

  it("--ring (anneau de focus shadcn, charte §6) résout vers --color-accent", async () => {
    const compiled = await compileGlobals();
    expect(compiled).toMatch(/--ring:\s*var\(--color-accent\)/);
  });
});
