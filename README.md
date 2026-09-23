# Vectora

Vectora is a browser-based 2D CAD and manufacturing workspace built with React, TypeScript, and Vite. Drawing, editing, generators, image tracing, nesting, CAM calculation, and previews run on the user's device. The application does not require a backend server or API keys.

## Run locally

Use Node.js 24 (also recorded in `.nvmrc`) and npm. If you use nvm, run `nvm use` first.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Use `npm ci` to install the dependency versions recorded in `package-lock.json`.

## Upload to GitHub and publish with Pages

1. Create a GitHub repository with your chosen name. Upload this project's contents at the repository root: `package.json`, `index.html`, and `.github` must be at the top level, not inside another `Vectora` folder. GitHub Desktop is a convenient way to include the hidden configuration files.
2. Include `src`, `scripts`, `legal`, `LEGAL_ATTRIBUTIONS.md`, `REAL_WORLD_VALIDATION.md`, the package and TypeScript configuration files, `vite.config.ts`, this README, `.github`, `.gitignore`, `.gitattributes`, and `.nvmrc`. The source archive provided with this preparation contains these files. Extract it first; uploading the ZIP alone will not deploy the application.
3. Do not upload `node_modules`, `dist`, `.DS_Store`, `*.tsbuildinfo`, local environment files, or the upload archive. Git clients use `.gitignore` to exclude these; a manual browser upload does not.
4. In the repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source.
5. Open **Actions → Build and deploy Vectora → Run workflow** and choose the repository's default branch. Future pushes to the default branch will build and publish automatically. Other branches and pull requests run build checks without publishing.
6. After the workflow succeeds, use the website link shown in **Settings → Pages** or the deployment job.

If the initial deployment runs before Pages is enabled, enable it in step 4 and run the workflow again. No personal access token or repository secret is required for the included workflow. Repository or organization policies must allow Actions and Pages. Pages availability for private repositories depends on your GitHub plan.

The build uses relative asset paths, so the same output works at `https://USERNAME.github.io/REPOSITORY/`, a user site, or a custom domain. Renaming the repository does not require a code change. GitHub builds the application and publishes only `dist`, including its third-party notices.

See the official [GitHub Pages workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [Vite relative-base documentation](https://vite.dev/guide/build#relative-base).

## Build and check

```sh
npm run build
npm run test:deployment
node scripts/nesting-worker-smoke.mjs
npm run preview
```

`build` checks TypeScript, compiles the application, and verifies that the bundled third-party notices match the dependency lockfile. `test:deployment` checks the production assets under both a root URL and a repository subdirectory using a static server with no development-server fallback. The nesting-worker check executes the built worker and checks results, progress, and error reporting.

The project also contains focused geometry, CAM, import/export, and browser checks; see the `test:*` scripts in `package.json`. The existing `*:browser` scripts require an isolated Chrome debugging session and a running development server; they are not automatically run by the Pages workflow.

## Browser capabilities and local data

- Drawing, editing, file import/export, tracing, generators, and CAM run in the browser. 3D preview requires WebGL support.
- Direct machine control requires a compatible browser with Web Serial, a supported device, and user permission. Serve over HTTPS. The app provides G-code export when direct connection is unavailable.
- Browsers with a supported file-system save picker can confirm a file write. Other browsers use downloads, whose completion the app cannot confirm.
- Preferences, cutter libraries, and recovery copies remain in the current browser profile. Publishing the app does not upload users' drawings to GitHub or provide cloud synchronization.
- Data stored at `localhost` does not automatically move to the published website. Save drawings as `.vectora` files before moving them between addresses or devices.
- Offline installation and guaranteed offline loading are not currently provided.

See [REAL_WORLD_VALIDATION.md](REAL_WORLD_VALIDATION.md) for the current scope of physical-machine validation and the recorded procedure.

## Project layout

- `src/`: application UI, document model, geometry, renderers, CAM, and recovery.
- `scripts/`: build support, checks, and audit tools.
- `legal/` and `LEGAL_ATTRIBUTIONS.md`: dependency inventory and third-party notices.
- `.github/workflows/pages.yml`: build checks and Pages deployment.
- `dist/`: generated website, excluded from source control.

## Third-party notices

Keep [LEGAL_ATTRIBUTIONS.md](LEGAL_ATTRIBUTIONS.md) with distributed builds; the build includes it automatically. The audit scope is documented in [legal/AUDIT.md](legal/AUDIT.md). These notices do not grant a license to Vectora itself; no new project license has been added by this repository setup.

After changing dependencies or bundled assets, review and regenerate the inventory with `npm run audit:licenses:write`, then check it with `npm run audit:licenses`. The detailed inventory records installed platform-specific packages and generated bundle hashes, so it is a local audit snapshot rather than a cross-platform CI comparison. The deployment build independently checks the notice's lockfile fingerprint.
