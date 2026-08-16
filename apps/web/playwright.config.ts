import { defineConfig, devices } from "@playwright/test";

/*
 * Cible axe-core en intégration continue (charte §10 : les ratios de
 * contraste sont vérifiés en amont, dans le document ; axe-core vérifie
 * l'emploi réel dans les composants — c'est ce second contrôle).
 * Serveur de prod (`next start`), pas `next dev` : plus proche de ce qui
 * est réellement livré, et démarre plus vite en CI qu'un dev server à froid.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
