import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'native-watchdog.spec.ts',workers:1,timeout:90000,reporter:[['list'],['json',{outputFile:'test-results/diagnostic-watchdog.json'}]],outputDir:'test-results/watchdog'});
