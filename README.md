# Viễn Du

Viễn Du is a web learning adventure with a cartoon 3D train journey, personal progress, asynchronous study groups, a journal, and optional quizzes. The browser app is the primary experience; Electron packages the same web app for Windows.

## Run locally

Use Node.js 24 LTS and npm 11, matching GitHub Actions. npm 10 may reject the lockfile while resolving peer dependencies.

```bash
npm ci
npm --prefix backend ci
npm --prefix backend run db:generate
npm start
```

`npm start` starts the local API/database and the web app at `http://localhost:8084` together. `npm run dev` and `npm run web` do the same thing. Healthy existing Viễn Du services are reused; occupied unrelated ports produce an actionable error. Keep the terminal open while the server runs. Guest mode works offline. Create a backend account to try sync, groups, and the quiz bank. To generate quizzes from documents with AI, set `GEMINI_API_KEY` in `backend/.env` and restart the backend; the key stays on the server. Documents are read on the device, and only extracted text is sent when choosing an AI quiz.

The countdown keeps running when you leave a study session. Each departure is counted once as a distraction; returning resumes immediately. **Kết quả tester** shows explicitly shared, anonymous session metrics and exports CSV for experiments. Testers publish or withdraw individual sessions from their summary; private goals, emails, and documents are not published.

## Preview a production web build

The preview server also requires port 8084. Stop the development server before starting it.

```bash
npm run build:web
npm run preview
```

The production files are written to `dist/`. See [web and Windows operations](docs/WEB_DESKTOP.md) for production hosting details.

## Package the Windows app

```bash
npm run build:web
npm --prefix desktop ci
npm --prefix desktop run package:win
```

The Windows installer is in `desktop/release/`. Set `VITE_API_URL` in the root `.env` or build environment for an online backend. GitHub Actions builds the installer and a ZIP of the web app on pushes to `main`; download them from the `Vien-Du-Windows` artifact in the **Build Windows app** workflow.

To launch the desktop build locally after creating `dist/` and installing desktop dependencies, run this separately. It stays open until you close the Electron app:

```bash
npm --prefix desktop start
```

See [web and Windows operations](docs/WEB_DESKTOP.md) for backend deployment and cross-packaging from macOS.
