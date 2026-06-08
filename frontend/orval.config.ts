import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: '../api-spec.yaml',
    output: {
      mode: 'single',
      target: 'src/api/generated/api.ts',
      client: 'axios',
      override: {
        mutator: {
          path: 'src/api/mutator.ts',
          name: 'customMutator',
        },
      },
    },
  },
});
