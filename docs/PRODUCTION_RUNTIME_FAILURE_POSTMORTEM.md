# Production Runtime Failure Postmortem

## Incident Summary

On 2026-08-23, the production reader was reported to fail with React's minified
error `#185` after the local-AI repair workflow was released. React `#185`
indicates an update-depth failure: the application entered a repeated render or
state-update cycle and the error boundary replaced the reader UI with the
`SYSTEM FAILURE` screen.

## User Impact

Users who reached the text-repair review workflow could lose access to the
application instead of seeing the review panel. The failure was limited to the
path that mounted the repair review component; an empty archive did not trigger
it because that component was never mounted.

## Detection

The incident was reported from production during release verification. The
initial browser smoke test missed it because the test archive contained no
books and therefore never opened the repair review panel.

## Root Cause

`RepairReviewPanel` selected two settings with an object literal passed directly
to Zustand:

```ts
useSettingsStore((state) => ({
    repairModelId: state.repairModelId,
    repairEnabled: state.textRepairMode !== 'off',
}))
```

That selector returned a new object for every external-store snapshot read.
React 19 uses `useSyncExternalStore` for this subscription path and requires
the snapshot result to be referentially stable when the store has not changed.
The unstable result caused React to repeatedly retry the render until it
reported error `#185`.

## Contributing Factors

- The component was new and had no mount regression test.
- The browser smoke test exercised the archive and settings routes with an
  empty local database, so the review panel never mounted.
- The first local preview served an older generated `dist` artifact labeled
  `9d2c80d-dirty`, not the current `main` commit. Production verification now
  rebuilds before preview testing and checks the embedded commit hash.
- Production minification exposed only React's numeric error code, making the
  update-loop source less obvious from the user-visible failure page.

## Remediation

- Wrapped the settings selector in Zustand's `useShallow`, which returns the
  same selected object when its fields have not changed.
- Added a deterministic `RepairReviewPanel` mount test with mocked database
  streams. The test ensures the panel renders and completes its subscriptions
  without entering an external-store update loop.
- Rebuilt the production bundle from `main` and verified the current embedded
  commit hash before runtime checks.

## Prevention and Release Gates

- Object selectors passed to Zustand hooks must use `useShallow` or be replaced
  with individual primitive selectors.
- New route-level components must have a mount test, including the non-empty or
  feature-enabled state needed to render the component.
- Production smoke tests must run against a freshly generated build and must
  exercise feature panels that are conditional on persisted data or settings.
- The release checklist requires TypeScript, focused regression tests, the full
  non-interactive test suite, lint, production build, and production-preview
  browser checks before pushing `main`.

## Recovery

The fix is source-compatible and does not alter persisted book, issue, revision,
or reading-state data. Users can recover by loading the updated deployment; no
local data migration or content rollback is required.