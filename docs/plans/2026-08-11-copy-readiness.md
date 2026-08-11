# Copy Engine Readiness Implementation Plan

> **For Codex:** Follow test-driven-development red/green cycles task-by-task.

**Goal:** Make RTDS health self-healing and make the shadow scorecard accurately answer whether the currently executable yes/no strategy is ready for live trading.

**Architecture:** Keep copy trading shadow by default. Detect silent RTDS sockets in the watcher, expose event freshness in health, aggregate gross and fee-adjusted shadow returns by all/executable segments, and derive a read-only readiness verdict from explicit thresholds. No environment mutation or automatic live enablement is added.

**Tech Stack:** TypeScript, Node test runner, PostgreSQL, Next.js/React.

---

### Task 1: RTDS silent-stream recovery

**Files:**
- Create: `src/watch/rtds.test.ts`
- Modify: `src/watch/rtds.ts`
- Modify: `src/watchlist.ts`
- Test: `src/watchlist.test.ts`

1. Write failing tests proving a stream is stale only after 90 seconds and watcher health requires fresh heartbeat plus fresh RTDS events.
2. Run the targeted tests and confirm failure because the helpers do not exist.
3. Add a connection-local watchdog that closes a silent socket, causing the existing reconnect path to run.
4. Include event freshness and connection age in `watchlistView` health.
5. Run targeted tests until green.

### Task 2: Executable and fee-adjusted scorecard

**Files:**
- Create: `src/copy/stats.test.ts`
- Modify: `src/copy/stats.ts`
- Modify: `src/config.ts`

1. Write failing tests for conservative fee-adjusted return and readiness thresholds.
2. Run the targeted test and confirm failure because the functions do not exist.
3. Add `feeAdjustedReturn(grossMultiplier) = grossMultiplier / (1 + feeBuffer) - 1`.
4. Aggregate both `all` and `executable` (`outcome` yes/no) segments with mean, median, win rate, fee-adjusted mean, and a large-sample normal 95% mean interval when `n >= 30`.
5. Add per-wallet executable resolution performance and concentration inputs.
6. Derive a readiness verdict requiring executable decisions on 14 distinct Beijing calendar days, 200 executable resolutions, maximum wallet share below 50%, positive fee-adjusted resolution return, and a fresh RTDS connection at least 24 hours old.
7. Run targeted tests until green.

### Task 3: API and UI presentation

**Files:**
- Modify: `app/api/agent/copystats/route.ts`
- Modify: `app/panels/watch-modal.tsx`
- Modify: `app/panels/watch.tsx`

1. Extend the Agent API note to define gross, net, and executable metrics.
2. Show a readiness card with individual pass/fail checks.
3. Show the executable segment first, including net mean, median, interval, and sample size.
4. Update the wallet table to show executable settled performance and sample concentration.
5. Keep the overall segment visible as research context without treating unsupported outcomes as live evidence.

### Task 4: Documentation and verification

**Files:**
- Modify: `README.md`
- Create: `db/migrations/020_copy_stats_index.sql`

1. Document that copy trading remains shadow until readiness passes and still requires both environment switches.
2. Run `pnpm test` and require all tests to pass.
3. Run `pnpm typecheck` and require zero errors.
4. Run `pnpm build` when the local environment permits; report any external database/configuration blocker separately.
