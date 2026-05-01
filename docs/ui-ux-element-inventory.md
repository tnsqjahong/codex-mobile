# Codex Mobile UI/UX Element Inventory

Scope: `src/domains/mobile/runtime/controller.ts`, `src/app/App.tsx`, `src/domains/mobile/components/*`, `src/common/ui/*`, and `src/client/index.css`.
Reference: `claude-code-mobile` mobile browser session patterns — compact navigation, clear action states, dense readable thread list, soft surfaces, explicit runtime/tool cards, and mobile-safe controls.

## Element checklist and applied task plan

| Area | Elements | Improvement task |
| --- | --- | --- |
| Pairing/bootstrap | brand row, status text, primary retry/login buttons, QR card, pair URL/code | Keep centered pairing flow, align button radius/focus treatment with global button system. |
| Workspace shell | skip link, app header, main pane, backdrop | Add focusable main landmark, smoother nav toggle states, icon-only header controls with labels. |
| Sidebar navigation | open/close menu, backdrop, project select, search field, new session button | Add explicit close affordance, richer active state, status/date metadata, better spacing, icon+label action buttons. |
| Thread list | loading skeleton, empty states, thread rows, active rows, status chips | Replace raw status with human labels, add status dot/chip, timestamps, hover/focus feedback. |
| Sidebar footer | Chat, Changes, Settings buttons, changed count badge | Add icons and consistent action row styling; make active tab easier to scan. |
| Start pane | hero question, suggested prompts | Add prompt icons and compact card affordance. |
| Timeline/messages | user messages, agent messages, Markdown body, attachments | Render markdown blocks, tables, code, lists and quotes with mobile-safe spacing and wrapping. |
| Runtime/tool rendering | command/web/file tool cards, JSON detail payload, status | Add icon, runtime summary, command/query/path preview, status badge, details panel with safer max-height. |
| Thinking/streaming | thinking indicator, follow-tail timeline | Add animated runtime indicator and clearer copy. |
| Queued messages | queued card, steer/edit/delete buttons | Improve card hierarchy and compact action buttons. |
| Composer | attachment, permission, model, token dial, send/stop, branch select, footer | Convert symbols to icons, improve stop/send states, improve pill density, add selected/open feedback. |
| Menus/dropdowns | model menu, effort menu, permission menu | Add menu roles, selected classes/check icons, clearer option hierarchy, polished popup spacing. |
| Suggestions | skill/file/slash suggestion picker and options | Keep scroll isolation; align option cards with global focus/hover system. |
| Changes view | back, refresh, commit, diff cards, status/file stats | Keep compact controls; inherits global button/focus styling and diff readability. |
| Settings view | account/runtime/notifications/collections | Keep card structure; inherits global controls and readable list styling. |
| Accessibility | focus-visible, skip link, aria labels, disabled states | Add visible focus and stronger labels for icon-only interactions. |


## Exhaustive interaction/action inventory

These are the concrete UI hooks currently rendered or bound in `src/domains/mobile/runtime/controller.ts` and covered by this pass.

### Pairing and bootstrap
- `data-recheck`: retry desktop readiness / pairing QR generation.
- `data-start-login`: start Codex/OpenAI device login from mobile pairing surface.
- `data-cancel-login`: cancel the login flow.
- `.qr-card`, `.pair-code-label`, `.pair-url`, `.pairing-minor`: QR, manual code, pair URL, status copy.

### Shell and navigation
- `.skip-link`: jump to `#main-content`.
- `data-toggle-sidebar`: open/close chat navigation, now iconized and exposes `aria-expanded`.
- `data-close-sidebar`: close button/backdrop for the overlay nav.
- `.app-header`, `.topbar-title`, `.header-change-button`: current thread/project heading and changed-file badge.

### Sidebar
- `#project-select`: project switcher.
- `#thread-search`: local thread search input.
- `data-new-thread`: start empty thread surface.
- `data-thread-id`: load a thread; active item now uses `aria-current`.
- `data-sidebar-tab="chat|changes"`: switch between chat and changes.
- `data-settings`: open settings shell.
- `.sidebar-section-label`, `.thread-status`, `.thread-meta`, `.skeleton-thread`: recents count, readable status chips, timestamps, loading state.

### Start pane
- `data-start-prompt`: insert suggested prompt into composer.
- `.start-suggestions`: suggested prompt list with icon affordance.

### Timeline and runtime rendering
- `.message.user`, `.message.agent`: user/agent bubbles.
- `.markdown-body`: safe lightweight markdown rendering for paragraphs, headings, lists, blockquotes, links, inline code, fenced code, horizontal rules, and tables.
- `.message-attachments`, `.attachment-preview`, `.image-preview`, `.file-preview`: attachment previews.
- `.thinking`, `.thinking-dots`: streaming/working indicator.
- `.tool-card`, `.tool-title`, `.tool-summary`, `.tool-preview`, `.tool-status`: command/web/file runtime item cards.
- `.approval-card`, `data-approval`, `data-decision`, `data-remember`: command/file/permission approval actions.
- `.queued-card`, `data-queue-steer`, `data-queue-edit`, `data-queue-delete`: queued message actions.

### Composer
- `#message-input`: chat textarea.
- `data-attach` and `#file-input`: upload/attach files.
- `data-menu-toggle="permission|model"`: open dropdown menus, now iconized and exposes `aria-expanded`.
- `data-effort`, `data-model`, `data-permission`: dropdown option actions, now selected with `role="menuitemradio"` + `aria-checked`.
- `.token-dial`: context usage indicator.
- `.composer-send.stop`: send/interrupt button state.
- `#branch-select`: branch switch/create control.
- `.attachment-pill`, `data-remove-attachment`, `data-remove-mention`: attachment/mention chips.

### Suggestions and slash commands
- `#composer-suggestions`: skill/file/app/slash suggestion popup.
- `data-suggestion-kind`, `data-suggestion-id`, `data-suggestion-name`, `data-suggestion-path`, `data-suggestion-root`: suggestion insertion hooks.

### Changes and settings
- `data-back-chat`, `data-refresh-changes`, `data-commit-changes`: changes view navigation/actions.
- `.change-summary`, `.change-file`, `.diff-block`: change summary and diff rendering.
- `data-enable-notifications`: browser notifications enablement.
- `data-back`: settings shell back navigation.

## Verification coverage expected
- TypeScript: `npm run typecheck`.
- Production bundle: `npm run build`.
- Browser runtime: Playwright reload plus DOM checks for iconized controls, sidebar open/close classes, model/permission dropdown selected states, tool summaries/previews, and console error count.
