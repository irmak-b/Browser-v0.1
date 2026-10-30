import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
process.env.BROWSER_CORE_INSTANCE_SCOPE = randomUUID();
export default defineConfig({
  testDir: 'tests/packaged', workers: 1, fullyParallel: false, timeout: 45000,
  reporter: [['list'], ['json', { outputFile: 'test-results/packaged-results.json' }]],
  outputDir: 'test-results/packaged',
});
