# Quickstart: Keep Archived Runs

## Prerequisites

- Use branch `002-keep-archived-runs`.
- Ensure dependencies are installed with the existing workspace lockfile.

## Validate The Fix

1. Review the feature spec and plan:

   ```bash
   sed -n '1,220p' specs/002-keep-archived-runs/spec.md
   sed -n '1,220p' specs/002-keep-archived-runs/plan.md
   ```

2. Run type checking:

   ```bash
   npm run typecheck
   ```

3. Run the automated test suite:

   ```bash
   npm test
   ```

4. Confirm the regression test is present in `packages/core/test/job-store.test.ts`:

   ```bash
   rg -n "updates archived runs without restoring them" packages/core/test/job-store.test.ts
   ```

## Expected Result

- Type checking passes.
- All tests pass.
- The archived-run regression test proves that updating an archived-only run updates the archive
  record, creates no live record, and keeps default run listings live-only.
