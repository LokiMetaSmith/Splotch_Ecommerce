# Bolt's Journal

This journal tracks critical performance learnings, anti-patterns, and insights specific to this codebase.

## 2024-05-23 - Parallelizing Shipment Tracking
**Learning:** The shipment tracker was processing orders sequentially using `await` in a loop, which is inefficient for network-bound operations.
**Action:** Replaced sequential loop with `Promise.allSettled` to parallelize API requests. This significantly reduces total polling time.
**Note:** `lowdb` writes the entire state to disk. Batching writes is crucial when parallelizing logic that modifies the DB to avoid race conditions or excessive I/O.
