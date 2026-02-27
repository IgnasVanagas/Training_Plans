# Training_Plans – Implementation Context Guardrails

Use this as default context for all future code changes in this repository.

## Product Context
- Full-stack endurance coaching platform.
- **Frontend**: React + TypeScript + Mantine + Vite + Recharts.
- **Backend**: FastAPI + SQLAlchemy.
- Key modules include activities, training calendar/plan, organizations/chat, integrations, and compliance scoring.

## Non-Negotiable Preservation Rule
- Preserve existing functionality unless the user explicitly asks to change behavior.
- Prefer minimal, surgical changes.
- Do not remove endpoints, data fields, workflows, or UI states that are currently used.

## Language / i18n Requirements (EN + LT)
- App supports **English (`en`)** and **Lithuanian (`lt`)**.
- For new/updated user-facing strings:
  - Use `t("...")` from `useI18n()` in React components where available.
  - Add missing keys to `frontend/src/i18n/translations.ts` (`literalTranslations.lt`).
- Avoid introducing hardcoded English strings in new UI.
- Preserve existing language switch behavior and DOM translation fallback logic.

## Theme Requirements (Light + Dark)
- All UI updates must work in both light and dark modes.
- Use Mantine/themed primitives (`useComputedColorScheme`, theme tokens, existing `ui` palette objects) instead of fixed colors where possible.
- Validate contrast/readability for:
  - text on cards/panels,
  - tooltips,
  - selected/active states,
  - chat bubbles and badges.

## UX Consistency Rules
- Keep existing information architecture unless asked to redesign.
- Match established patterns in the codebase (Mantine spacing, radius, typography scale, card layout).
- Do not introduce extra views/modals/flows unless requested.

## High-Risk Areas (Handle Carefully)
- `frontend/src/pages/ActivityDetailPage.tsx`
  - Recharts sync/tooltip behavior can regress easily.
  - Hover/slider interactions should continuously update while scrubbing.
- `frontend/src/pages/dashboard/DashboardOrganizationsTab.tsx`
  - Messenger-style thread list + active chat pane behavior.
  - Maintain send-on-enter behavior and thread switching.
- Planned comparison/compliance explainability payloads
  - Maintain compatibility with existing response shapes and fallback rendering.

## API / Data Contract Safety
- Keep backward compatibility for backend payloads consumed by frontend.
- If adding fields, prefer additive changes.
- Avoid renaming/removing fields without coordinated frontend updates.

## Validation Checklist for Every Meaningful UI/Logic Change
1. Type/editor diagnostics are clean for changed files.
2. Frontend builds successfully: `npm run build` in `frontend`.
3. If backend changed, run at least targeted backend tests (existing local pattern uses pytest).
4. Verify i18n keys exist for all new visible strings.
5. Verify dark + light mode visuals remain readable.

## Change Style
- Be concise in implementation.
- Fix root causes, not superficial patches.
- Avoid unrelated refactors.
- Document only when it improves maintainability or requested by the user.
