# Leo AI — browser-first starter

## What is new in 0.3
- **Tools**: the model can call `web_search` (Tavily), `fetch_url` (SSRF-guarded), `run_python` (E2B, charts shown inline), `calculator` and `remember`. Tool activity and sources are shown under the answer.
- **Attachments**: images, PDF, DOCX and text/code files (button, drag-and-drop or paste). Images/PDFs automatically use `MODEL_VISION`.
- **Artifacts**: the model can deliver web pages, SVG, Markdown and code in a side panel with sandboxed live preview, copy and download.
- **Projects**: custom instructions and knowledge files applied to every chat of a project.
- **Memory**: facts Leo saves on request; viewable, addable and deletable in Settings.
- **Cloud sync**: chats, projects and memory in Firestore (per-user rules in `firestore.rules`), with a browser-only fallback.
- **Accounts**: Google and email sign-in; guest sessions upgrade without losing data.
- **Better chat rendering**: tables, nested and task lists, quotes, links, italics, rules. LaTeX is not rendered.
- **Limits**: per-minute and per-day request caps per user (see `.env.example`).

Leo AI has two modes:
- **Leo Chat**: general AI chat through OpenRouter.
- **Leo Code**: ZIP text-file context and code review. The first version proposes edits in chat; it does not yet apply patches back into the ZIP.
- **Sandbox proof-of-concept**: `/api/sandbox` runs a short Python snippet in an isolated E2B sandbox. This is NOT yet a full project terminal or build environment.

## Requirements
- Node.js 20+
- OpenRouter API key
- Firebase project
- Vercel account for deployment
- E2B API key only if testing the sandbox endpoint

## 1. Install and run
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open http://localhost:3000.

## 2. Configure OpenRouter
Add `OPENROUTER_API_KEY` to `.env.local`. It is server-only and must never have the `NEXT_PUBLIC_` prefix.
The model router is in `src/lib/model-router.ts`. Set `MODEL_FAST`, `MODEL_GENERAL`, and `MODEL_CODING` to model IDs that currently exist in your OpenRouter account. Model names/prices change; verify them in the OpenRouter model directory. The automatic router is a simple keyword-based starter, not a model that independently decides every task.

## 3. Firebase setup
1. Open Firebase Console and create a project.
2. In Authentication → Sign-in method, enable **Anonymous** for the starter. You can replace this with email/password later.
3. In Project settings → Your apps, register a Web app.
4. Copy the web config values into `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID`.
5. In Project settings → Service accounts, generate a private key. Put the full JSON on one line into `FIREBASE_SERVICE_ACCOUNT_JSON`. Treat this as a secret; never commit it.
6. Create a Firestore database (Build → Firestore Database), then publish the rules from `firestore.rules` (Rules tab, or `firebase deploy --only firestore:rules`). Without them, cloud sync is denied and Leo falls back to this browser only.
7. For Google sign-in enable the **Google** provider in Authentication and add your deployed domain under Authentication → Settings → Authorized domains. Email sign-in needs the **Email/Password** provider.

Firebase Web config is not a substitute for security rules. Keep Firestore rules locked down and verify user identity on server routes.

## 4. Test authentication locally
The `/api/chat` route requires a Firebase ID token verified with Firebase Admin. If you haven't configured the service-account JSON, the route will return an auth configuration error. Do not make the API public to bypass this check.

## 5. Configure E2B sandbox (optional)
Create an E2B account and add `E2B_API_KEY`. `/api/sandbox` is a proof-of-concept for executing short Python snippets in an isolated sandbox. It is not wired to ZIP uploads and is not a terminal. Before making this public, add rate limits, per-user quotas, spend caps, job timeouts, logging, and review the sandbox provider's current isolation/network controls.

## 6. Deploy to Vercel
1. Push this folder to a new private GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Framework preset: Next.js.
4. Add the same environment variables from `.env.example` in Vercel → Project → Settings → Environment Variables. Paste JSON service account as a single line.
5. Deploy, then test login and chat.
6. After changing environment variables, redeploy.
7. Never add `.env.local` or service-account JSON to GitHub.

## Security checklist before inviting users
- Add rate limiting and per-account request/token caps.
- Set OpenRouter spend limits.
- Validate upload count, archive size, file count, total uncompressed size, and paths on the server too.
- Do not run project-provided scripts or arbitrary shell commands in the web server.
- Keep project execution in disposable isolated sandboxes with CPU/RAM/time limits and network restrictions.
- Add approval before applying file changes or running risky commands.
- Add content deletion/export and privacy notice.
- Implement Firestore history only with per-user rules and server-side ownership checks.

## Current MVP limitations
- ZIP parsing happens in the browser and selected text files are sent as model context.
- Binary assets are skipped; files are not persisted.
- AI suggestions are displayed as text, not automatically applied.
- Sandbox endpoint only runs Python snippets; no arbitrary terminal, package install, or project build yet.
- Attachments are limited to about 4 MB per message (Vercel request body limit); they are not saved in history, only their names.
- Image/PDF understanding requires a multimodal model in `MODEL_VISION`; the default Groq text models cannot read images.
- Each reply has a ~55 s budget on Vercel; long tool chains may be cut short.
- Firebase Anonymous Auth is enabled by default for easy testing; add a real sign-in option before production.
