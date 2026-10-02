import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source (the `source` export condition).
export default defineConfig({ resolve: { conditions: ['source'] }, ssr: { resolve: { conditions: ['source'] } } });
