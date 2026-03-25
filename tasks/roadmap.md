# Roadmap: two-layer-cake

> Date: 2026-03-24

---

## Code Review Remediation (2026-03-24)

> Source: Expert code review, verified against source code

### Critical

- [ ] **`planner.ts:15`** — Global mutable `planIdCounter` causes cross-test pollution and is unsafe in concurrent use. Fix: move to instance-level counter or use `crypto.randomUUID()`. Remove `resetPlanIdCounter`.
- [ ] **`create-signal.ts:9`** (adapter-claude + adapter-openai) — `setTimeout` timer leaks when request completes before timeout. Fix: use `AbortSignal.timeout(timeoutMs)` (Node 18+) or return a cleanup function.

### High

- [ ] **`error-handler.ts:54`** — Rule-based retry path requires `retryFn` parameter that is never passed by `DAGExecutor`. Entire retry tier is dead code. Fix: either remove `retryFn` requirement, or pass it from DAGExecutor.
- [ ] **`dag-executor.ts:147`** — `contextFromPrevious` only injected when already truthy. If planner doesn't set it, upstream dependency results are silently dropped. Fix: always inject dependency results when `dependsOn` is non-empty.
- [ ] **`scoped-tool-registry.ts:49`** — `checkPermission` passes empty `{}` instead of actual tool params to `onConfirmation` callback. Fix: pass `validated` params.
- [ ] **`orchestrator.ts:243`** — `stream()` swallows errors via `.catch(() => {})`. If error occurs before event emission, consumers never learn. Fix: emit synthetic error event or terminate async iterable with error.

### Medium

- [ ] **`token-budget.ts:14`** — `_childBudget` in orchestrator.ts:141 is created but never used. Sub-plan budget enforcement not wired up. Fix: wire forked tracker into sub-plan execution.
- [ ] **`dag-executor.ts:296`** — `runningPromises` Map declared but never populated. Dead code. Fix: remove.
- [ ] **`event-bus.ts:87`** — `toAsyncIterable` completion handlers registered but never unregistered. Minor memory leak on repeated `stream()` calls. Fix: store handler refs and remove in `cleanup()`.
- [ ] **`orchestrator.ts:36`** — `abortControllers` map entries never cleaned up on successful completion. Fix: delete in `finally` block.
