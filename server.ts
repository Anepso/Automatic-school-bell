import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { AI_LIMITS, createAiAssistantHandler } from './ai-assistant-endpoint';
import {
  describeGeminiCredential,
  resolveGeminiCredential,
  startCredentialBroker,
} from './gemini-credential';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
// B6-GEM-04: loopback-only by default. The AI endpoint holds a credential, so a
// 0.0.0.0 default would expose it to the whole LAN via `npm run dev` / `npm start`.
// `electron/main.cjs` already passes an explicit loopback HOST, so desktop
// behaviour is unchanged.
const HOST = process.env.HOST || '127.0.0.1';

// B7 Stage B-1 (F-01/F-02/F-03) — production runtime foundation.
//
// This process is no longer `tsx server.ts`. It is bundled ahead of time into
// `dist-electron/backend.cjs` and started by `electron/main.cjs` as a child of
// `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, so a packaged Windows app
// needs no system Node, no `tsx`, and no `.ts` file at runtime.
//
// Two consequences for this file:
//
// 1. It must not import `vite` at module scope. Vite is a frontend tool; pulling
//    it in here is what made production depend on `node_modules/tsx` → `esbuild`
//    → a platform-specific binary (`@esbuild/linux-x64`), which cannot run on a
//    Windows machine. The import below is dynamic and sits inside the
//    development branch, so production never resolves it, and the bundler marks
//    `vite` external so it is absent from the production artifact entirely.
//
// 2. It must not resolve assets relative to its own file. `import.meta.url` is
//    not available in the CommonJS output, and the bundle lives in a different
//    directory than this source. Electron tells us the app root explicitly, and
//    a standalone `npm run dev` falls back to its working directory — which is
//    the project root.
const APP_ROOT = process.env.SCHOOL_BELL_APP_ROOT || process.cwd();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// B7 Stage B-2 (D-1 BYOK) — the secure broker.
//
// `electron/main.cjs` sets SCHOOL_BELL_CREDENTIAL_BROKER=1 on this child and
// then pushes the user's key, decrypted from `safeStorage`, down this process's
// stdin. That replaces Stage B-1's interim environment-variable transport: a
// pipe to a child we spawned is not readable by other processes, is not in `ps`
// output, is not on disk, and can be written again the moment the user saves or
// deletes a key — none of which an environment variable can do.
//
// The reader attaches ONLY when that env var is set. `npm run dev` leaves this
// process's stdin attached to the developer's terminal, and an unconditional
// reader would consume their keystrokes.
startCredentialBroker();

// Read on every request rather than once at boot. A key saved five minutes after
// launch has to reach Gemini without a restart, and the broker can be updated at
// any time. The cost is one object read; the contract with B6 (`readApiKey`) is
// unchanged and nothing about the endpoint is aware this happens per call.
const credentialForRequest = () => resolveGeminiCredential();

// B6-GEM-14: bounded request body. Previously the Express default (~100kb) with
// no limit on prompt length or context size.
app.use(express.json({ limit: AI_LIMITS.maxRequestBodyBytes }));

// AI Assistant endpoint for schedule generation, analysis, and modification.
//
// B6: the AI path (credential handling, timeout, bounded retry, stable error
// contract, no fabricated fallback, output validation, prompt/context separation)
// lives in `ai-assistant-endpoint.ts` so it can be unit-tested without booting
// Express/Vite/Electron. The Gemini SDK is imported lazily inside that module,
// so a missing or broken AI SDK can never prevent School Bell from starting.
//
// B7: `readApiKey` is now supplied here instead of falling through to
// `process.env.GEMINI_API_KEY` inside the endpoint. The B6 handler contract is
// untouched — only the source of the key moved, and it moved *out* of the
// transport rather than being duplicated. `null`/`undefined` are equivalent to
// the endpoint (both mean "no key", both produce AI_ERROR_CODE.NOT_CONFIGURED);
// the coercion just avoids widening the B6 dependency type.
app.post(
  '/api/ai/assistant',
  createAiAssistantHandler({ readApiKey: () => credentialForRequest().apiKey ?? undefined })
);

// Setup Vite dev server or serve static build
async function startServer() {
  if (IS_PRODUCTION) {
    const distDirectory = path.resolve(APP_ROOT, 'dist');
    app.use(express.static(distDirectory));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDirectory, 'index.html'));
    });
  } else {
    // Dynamic, dev-only. Never reached when NODE_ENV=production.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`School Bell app running on port ${PORT}`);
    console.log(
      `School Bell Gemini credential at boot: ${describeGeminiCredential(resolveGeminiCredential())}` +
        ' (a stored key arrives from the broker just after this line)'
    );
  });
}

startServer();