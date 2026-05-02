# Frontend structure

This frontend now follows a layered shape inspired by `HeyTraders-Frontend`.

## Layers

- `src/app`
  - React app entry composition.
- `src/common`
  - shared UI primitives, hooks and utilities.
  - `src/common/ui` contains shadcn/ui components.
  - `src/common/lib` contains shared helpers such as `cn()`.
- `src/domains/mobile`
  - mobile-specific runtime, components and future feature slices.
  - `components/` contains visible UI surfaces.
  - `runtime/controller.ts` contains Codex mobile state machine and side effects.
  - placeholder `hooks/`, `services/`, `state/`, `types/`, `utils/` folders are prepared for future decomposition.
- `src/client`
  - browser bootstrap only (`main.tsx`, `index.css`, `vite-env.d.ts`).
- `src/bridge`
  - non-UI bridge/server runtime untouched.

## Current component entry points

- `src/app/App.tsx` — chooses pairing / workspace / settings shells.
- `src/domains/mobile/components/pairing-view.tsx`
- `src/domains/mobile/components/workspace-shell.tsx`
- `src/domains/mobile/components/sidebar.tsx`
- `src/domains/mobile/components/chat-pane.tsx`
- `src/domains/mobile/components/composer.tsx`
- `src/domains/mobile/components/settings-pane.tsx`

## Why this shape

- Keeps `common/*` reusable like `HeyTraders-Frontend`.
- Keeps `domains/mobile/*` free to grow without turning `src/client` into a monolith again.
- Separates browser bootstrap from mobile domain logic.
- Makes future extraction of runtime state/services into dedicated files incremental and low-risk.
