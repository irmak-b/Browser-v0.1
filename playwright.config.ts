import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
// Local test invocations must never focus or attach to a user's running app.
process.env.BROWSER_CORE_INSTANCE_SCOPE = randomUUID();
export default defineConfig({
  testDir: 'tests/electron', workers: 1, fullyParallel: false, timeout: 45000,
  reporter: [['list'], ['json', { outputFile: 'test-results/electron-results.json' }]],
  outputDir: 'test-results/electron',
});
