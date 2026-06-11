# frontend/ index

| Item | Description |
|---|---|
| `src/` | All application source code |
| `public/` | Static assets copied verbatim to dist |
| `dist/` | Vite build output (gitignored) |
| `package.json` | Dependencies and npm scripts |
| `vite.config.ts` | Vite configuration |
| `orval.config.ts` | Orval config — points at `../api-spec.yaml`, outputs to `src/api/generated/` |
| `tsconfig*.json` | TypeScript project references |
| `eslint.config.js` | ESLint flat config |
| `.env.example` | Frontend dev server env var template |
| `index.html` | SPA shell; backend injects `window.__CONFIG__` into `<head>` |
