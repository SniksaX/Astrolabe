import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * Audit axe-core des parcours principaux (charte §10, docs/adr/0005). Ne
 * remplace pas les ratios calculés dans docs/charte-visuelle.md §2/§6 :
 * vérifie leur emploi réel dans le DOM rendu (contraste calculé, focus
 * visible, rôles ARIA), là où une collision de tokens comme celle du
 * 2026-08-14 (docs/journal.md) serait détectée automatiquement.
 */

const SESSION_COOKIE = "astrolabe_session";

const publicRoutes = ["/", "/login", "/inscription"];
// Écrans 04/05/08/10/11 : garde-fou cookie présence-seule (middleware.ts),
// pas d'appel API réel nécessaire pour ces coquilles/stubs.
const dashboardRoutes = ["/chat", "/sources", "/sources/ajouter", "/reglages", "/offre"];

for (const route of publicRoutes) {
  test(`a11y : ${route} (public)`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });
}

test.describe("a11y : espace authentifié (cookie de présence simulé)", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: SESSION_COOKIE, value: "a11y-fixture", url: baseURL! },
    ]);
  });

  for (const route of dashboardRoutes) {
    test(`a11y : ${route}`, async ({ page }) => {
      await page.goto(route);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
