# AGENTS.md — Herdr Mod Repository Guidelines (`my-herdr-mods`)

This repository contains community mods for [**Herdr**](https://herdr.dev) published to the [Herdr Mod Gallery](https://herdr.dev/gallery/?type=mods) via the `herdr-mod` GitHub topic.

Whenever you build a new mod or improve an existing mod in this repository, **follow these rules and conventions strictly**.

---

## 1. Read the Installed Herdr Runtime Docs First

Before writing or modifying any GPUI/Herdr code, read the user's live Herdr app documentation and type definitions in `~/.config/herdr-app` (on Windows: `$HOME\.config\herdr-app`, or `$env:HERDR_APP_HOME` if set):

1. `~/.config/herdr-app/AGENTS.md` — Herdr's runtime rules, layout schema, commands, and `RECIPE.md` specification.
2. `~/.config/herdr-app/herdr.d.ts` — Host APIs (`spaces`, `panes`, `agents`, `terminals`, `theme`, `exec`, `readTextFile`, `watchFolder`, `shared`, `setShared`, `openOverlay`, `closeOverlay`, `props`, `run`, etc.).
3. `~/.config/herdr-app/gpui-kit.d.ts` — Exact `gpui-kit` and `gpui-base` element builders and style methods for the installed `gpui-shell` version.

> **Never guess GPUI or Herdr APIs.** There is no DOM, HTML, CSS, Node standard library inside `main.js`, or `setTimeout` (use `cx.timer.every` / `cx.timer.after`). Only methods declared in `gpui-kit.d.ts` and `herdr.d.ts` exist at runtime.

---

## 2. Repository Layout & Herdr Gallery Convention

Each mod lives in its own top-level folder `<mod-name>/` structured like `~/.config/herdr-app` **without** a `layouts/` folder:

```text
my-herdr-mods/
├── AGENTS.md
├── README.md
├── LICENSE
├── <mod-name>/
│   ├── RECIPE.md                # Required 6-section brief to rebuild the mod from scratch
│   ├── preview.png              # Required screenshot captured via `herdr-app shot`
│   ├── keys.json                # Optional shortcut snippet to merge into user's keys.json
│   └── mods/
│       └── <mod-name>/
│           ├── main.js          # Default-exported class extending View (required)
│           ├── mod.json         # Placement & overlay manifest (required)
│           ├── helpers.js       # Pure logic / parsers (no "herdr" / "gpui-kit" imports)
│           ├── helpers.test.js  # Node unit tests (`node --test`)
│           └── *.svg            # Mod-local icons referenced as `mods/<mod-name>/<icon>.svg`
```

### Rules for Gallery Packaging
- **No `layouts/` directory inside mod packages:** A mod is a component added to a user's existing layout. Including a `layouts/` directory causes Herdr's gallery indexer to treat it as a layout instead of a mod.
- **Keep generated files out of git:** `herdr-app check` writes `gpui-kit.d.ts` and `jsconfig.json` into the mod folder for editor type-checking. Always remove or ignore (`gpui-kit.d.ts`, `herdr.d.ts`, `jsconfig.json`, `tsconfig.json`) before committing.
- **Asset paths:** Reference SVG/PNG assets inside a mod as `"mods/<mod-name>/<file>.svg"` (relative to `~/.config/herdr-app`).

---

## 3. Required `RECIPE.md` Format

Every `<mod-name>/RECIPE.md` is an executable specification that another coding agent can use to rebuild the mod from an empty folder. Write it from the real code in this exact section order:

1. `# <Title>` — One paragraph describing what the person sees and gets, followed by `![<Title>](preview.png)`.
2. `## What you see` — Regions top-to-bottom or left-to-right, exact pixel sizes, radius/padding values, theme color tokens (`t.surface`, `t.popover`, `t.done`, `t.working`, `t.blocked`, etc.), and typography.
3. `## How it behaves` — Status states, click/hover/key interactions (`Escape`, tab switching, link classification), polling intervals, and state persistence (`shared()`, `localStorage`).
4. `## Built from` — File list, `mod.json` shape, layout block wiring, `gpui-kit`/`gpui-base` components used, `herdr` APIs called, and external CLI commands executed via `exec()`.
5. `## Watch out` — Edge cases, platform pitfalls (Windows vs. macOS/Linux), sizing traps, and a clear disclosure of any external commands (`exec`, `hc`), network calls, or filesystem reads outside the mod folder.
6. `## Done when` — Concrete verification checks (`node --test`, `herdr-app check`, `herdr-app status`, and interactive behaviors) that prove a build works.

---

## 4. Architecture & GPUI Best Practices

### 4.1 Per-Mod Sandbox & Single-Mod Dual-Role Pattern
- Herdr strictly sandboxes each `mods/<name>/` directory. Relative imports across sibling mods (`import ... from "../other-mod/helpers.js"`) **fail at runtime** with `resolves outside the application directory`.
- When a mod has both a layout block (e.g., status bar or header button) and a popup/dialog overlay, implement **both roles in the same mod** (`mods/<name>/main.js`) and branch on `Boolean(props()?.overlay)`.

### 4.2 Intrinsic Sizing for `kind: "popup"` Overlays
- Herdr sizes `kind: "popup"` overlays to their children's intrinsic height (up to `mod.json`'s `height`).
- **Never** put `.size_full()` on a popup root or `.flex_1().min_h(0)` on a popup body—inside an auto-height popup, flex-1 children collapse to `0px`.
- **Do** use `.w_full()` on the popup root, `.max_h(360).overflow_y_scrollbar()` on the scrollable body, and `.flex_none()` on header items and cards.
- **Do not** add `.border_1()` on the outer popup root; Herdr already draws the popup frame, border, rounded corners, and shadow.
- Center icon buttons (`✕`) using `h_flex().items_center().justify_center()`, not bare `div()`.

### 4.3 Testable Pure Modules (`node --test`)
- Node's built-in test runner (`node --test`) cannot resolve Herdr's virtual `"herdr"` or `"gpui-kit"` modules.
- Keep all data parsing, path normalization, and state merging in pure ES modules (`helpers.js`, `providers/*.js`) and pass host functions like `exec` via dependency injection (`fetchRaw(exec)`).
- Every new feature or bugfix must have unit tests in `helpers.test.js` verified via RED → GREEN TDD.

### 4.4 External Process Hygiene (`exec`)
- Always pass an explicit `{ timeout }` to `exec()`.
- If spawning a helper script or JSON-RPC server (such as `codex app-server`), close `stdin` on completion, wait for `process.stdout.write(..., callback)` to flush before exiting, and kill the process tree (`taskkill /PID <pid> /T /F` on Windows) if an internal timeout fires so no orphaned background processes survive.

---

## 5. Development & Verification Workflow

When modifying a mod `<name>` in a clone of this repository:

### Step 1: Run Unit Tests (TDD)
```powershell
node --test .\<name>\mods\<name>\helpers.test.js
```

### Step 2: Validate GPUI Description with `herdr-app check`
```powershell
herdr-app check .\<name>\mods\<name>
```
*(Always remove the generated `gpui-kit.d.ts` and `jsconfig.json` before `git status` / `git commit`, or rely on `.gitignore`.)*

### Step 3: Live-Test in the Running Herdr Window
Never overwrite Herdr's shipped mods (`files`, `workspace-status`, `tabs`, `pane`, etc.) or shipped layouts (`layouts/main.json`). Instead, sync your mod into `~/.config/herdr-app/mods/<name>` and wire it into a cloned layout (e.g. `layouts/main-md.json`):

```powershell
# Copy updated mod files to the live Herdr config directory
Copy-Item -Recurse -Force ".\<name>\mods\<name>\*" "$HOME\.config\herdr-app\mods\<name>\"

# Verify zero runtime or layout errors
herdr-app status

# Capture a live window screenshot to visually inspect spacing, colors, and overlays
herdr-app shot .\<name>\preview.png
```

### Step 4: Update Docs & Commit
1. Update `<name>/RECIPE.md` and root `README.md` if features, providers, or UI changed.
2. Confirm `git status` contains no generated `.d.ts` or `jsconfig.json` files.
3. Commit and push to `main`.
