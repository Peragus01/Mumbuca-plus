import { defineConfig } from 'vitest/config';

// `npm run test:chain`: integration tests against a local solana-test-validator started in WSL by
// the globalSetup (see test/chain/setup/local-validator.ts). Uses the prebuilt
// anchor/target/deploy/mumbuca_plus.so; rebuild it with `anchor build` in WSL when the program changes.
export default defineConfig({
  test: {
    include: ['test/chain/**/*.integration.test.ts'],
    globalSetup: ['test/chain/setup/local-validator.ts'],
    testTimeout: 60000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
