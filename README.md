# Whiteboard App

This workspace now uses the imported hockey rink engine starter as its project baseline.

The app is a Next.js shell that hosts a regulation rink renderer, geometry utilities, runtime helpers, and an architecture roadmap for the next phases of the whiteboard project.

## Startup

Use Corepack Yarn in this repository:

```bash
corepack yarn install
corepack yarn dev
```

Open `http://localhost:3000` in a browser.

## Scripts

```bash
corepack yarn dev
corepack yarn build
corepack yarn lint
corepack yarn test --run
```

## Project Structure

- `app/`: Next.js app shell and current landing page for the rink engine.
- `src/features/rink/`: imported rink domain model, geometry helpers, runtime modules, renderer, and tests.
- `AI_CODING_ROADMAP_README.md`: source-of-truth roadmap and architecture guidance from the starter archive.

## Current Baseline

- The homepage renders the imported `RinkCanvas` component.
- Clicking the rink reports feet-based coordinates and containing semantic zones.
- Geometry regression tests run under Vitest.

## Next Work

1. Add editor state for players, puck paths, and drill objects.
2. Expand the runtime modules from placeholder derivation logic to real event derivation.
3. Add save/load flows for drill serialization contracts.
