import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope explicite : exclut e2e/ (specs Playwright, exécutées séparément
    // via `npm run test:a11y`), que le glob par défaut de Vitest attraperait
    // sinon (les deux utilisent l'extension .spec.ts/.test.ts).
    include: ["tests/**/*.test.ts"],
  },
});
