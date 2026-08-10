import { defineConfig } from 'vitest/config';

// Deliberately standalone (not the SvelteKit app's vite.config.ts): the unit
// tests here target plain TS logic with no $lib/$app aliases or DOM needs, so
// there's no reason to pull in the SvelteKit/Tailwind plugins for them.
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts']
  }
});
