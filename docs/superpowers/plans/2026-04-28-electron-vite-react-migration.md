# Electron Vite React Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the desktop app to an Electron + Vite + React + TypeScript renderer without regressing the current UI or Electron service behavior.

**Architecture:** Keep the existing Electron main process, preload bridge, IPC handlers, native dependencies, assets, and service layer. Add Vite as the renderer build pipeline and React as the renderer runtime bootstrap, then load the existing battle-tested renderer behavior through that runtime while preserving the current DOM surface for visual parity.

**Tech Stack:** Electron, Vite, React, TypeScript, Node test runner, electron-builder.

---

### Task 1: Prove The New Renderer Stack Is Required

**Files:**
- Create: `ElectronSpike/tests/vite-react-migration.test.js`

- [ ] **Step 1: Write the failing test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const indexHtml = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");

test("renderer is built with Vite, React, and TypeScript", () => {
    assert.match(packageJson.scripts.build, /build:main/);
    assert.match(packageJson.scripts.build, /build:renderer/);
    assert.match(packageJson.scripts.check, /check:main/);
    assert.match(packageJson.scripts.check, /check:renderer/);
    assert.ok(packageJson.dependencies.react);
    assert.ok(packageJson.dependencies["react-dom"]);
    assert.ok(packageJson.devDependencies.vite);
    assert.ok(packageJson.devDependencies["@vitejs/plugin-react"]);
    assert.ok(packageJson.devDependencies["@types/react"]);
    assert.ok(packageJson.devDependencies["@types/react-dom"]);
});

test("renderer html enters through a React TypeScript module", () => {
    assert.match(indexHtml, /id="reactRuntimeRoot"/);
    assert.match(indexHtml, /type="module"\s+src="\.\/main\.tsx"/);

    const mainTsx = fs.readFileSync(path.join(root, "src", "renderer", "main.tsx"), "utf8");
    assert.match(mainTsx, /react-dom\/client/);
    assert.match(mainTsx, /createRoot/);
    assert.match(mainTsx, /import\("\.\/renderer\.js"\)/);
});

test("Electron can load Vite dev server and packaged renderer output", () => {
    const mainSource = fs.readFileSync(path.join(root, "src", "main.ts"), "utf8");
    assert.match(mainSource, /VITE_DEV_SERVER_URL/);
    assert.match(mainSource, /loadURL\(devServerUrl\)/);
    assert.match(mainSource, /dist",\s*"renderer",\s*"index\.html"/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vite-react-migration.test.js`

Expected: FAIL because the package has no Vite/React scripts or React TypeScript renderer entry.

### Task 2: Add Vite React Renderer Bootstrap

**Files:**
- Modify: `ElectronSpike/package.json`
- Modify: `ElectronSpike/package-lock.json`
- Modify: `ElectronSpike/src/renderer/index.html`
- Create: `ElectronSpike/src/renderer/main.tsx`
- Create: `ElectronSpike/src/renderer/vite-env.d.ts`
- Create: `ElectronSpike/vite.config.ts`
- Create: `ElectronSpike/tsconfig.main.json`
- Create: `ElectronSpike/tsconfig.renderer.json`
- Modify: `ElectronSpike/tsconfig.json`

- [ ] **Step 1: Add dependencies and scripts**

Run: `npm install react react-dom && npm install --save-dev vite @vitejs/plugin-react @types/react @types/react-dom`

Then set scripts so `build` runs `build:main` and `build:renderer`, `check` runs both typechecks, and `start` builds before launching Electron.

- [ ] **Step 2: Add React runtime root**

Insert `<div id="reactRuntimeRoot"></div>` near the end of `src/renderer/index.html` and replace the legacy script tags with `<script type="module" src="./main.tsx"></script>`.

- [ ] **Step 3: Add React TypeScript runtime**

Create `src/renderer/main.tsx` that imports React, creates a root at `reactRuntimeRoot`, imports `styles.css`, and dynamically imports legacy renderer modules in their existing order.

- [ ] **Step 4: Split TypeScript configs**

Keep main/preload compilation on Node16 in `tsconfig.main.json`, add Vite renderer checking in `tsconfig.renderer.json`, and make root `tsconfig.json` reference both.

- [ ] **Step 5: Run migration test**

Run: `node --test tests/vite-react-migration.test.js`

Expected: PASS.

### Task 3: Teach Electron About Vite Dev And Packaged Renderer Output

**Files:**
- Modify: `ElectronSpike/src/main.ts`
- Modify: `ElectronSpike/package.json`

- [ ] **Step 1: Add renderer URL resolution**

Update `createMainWindow()` to use `process.env.VITE_DEV_SERVER_URL` when present and otherwise load `dist/renderer/index.html`.

- [ ] **Step 2: Keep packaging output included**

Keep `dist/**/*` in electron-builder `files` so both main process output and Vite renderer output are packaged.

- [ ] **Step 3: Run migration test**

Run: `node --test tests/vite-react-migration.test.js`

Expected: PASS.

### Task 4: Verify Existing UI Contract And Build

**Files:**
- Modify only if tests expose migration regressions.

- [ ] **Step 1: Run type checks**

Run: `npm run check`

Expected: exit code 0.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: exit code 0 and renderer assets written to `dist/renderer`.

- [ ] **Step 3: Run test suite**

Run: `node --test tests/*.test.js`

Expected: exit code 0.

- [ ] **Step 4: Run Electron smoke start when build passes**

Run: `npm start -- --disable-gpu`

Expected: Electron launches with the same current UI through the Vite-built renderer.
