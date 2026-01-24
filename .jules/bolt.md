# Bolt's Journal

## 2024-05-22 - [Lowdb Array vs Object]
**Learning:** `lowdb` data was previously an array, leading to O(n) lookups. Converting it to an object keyed by ID allowed for O(1) access.
**Action:** When working with `lowdb` or similar JSON stores, always prefer object maps over arrays for collections that require frequent ID lookups.

## 2024-05-22 - [Canvas Batching]
**Learning:** Drawing individual lines on a canvas is expensive. Batching them into a single path (using `moveTo` / `lineTo`) and calling `stroke()` once significantly improves performance.
**Action:** Look for loops in canvas drawing code that call `stroke()` or `fill()` repeatedly.

## 2024-05-22 - [DocumentFragment]
**Learning:** Appending elements to the DOM in a loop causes reflows. Using `DocumentFragment` to batch appends and inserting it once eliminates this overhead.
**Action:** Always check loop-based DOM insertions.

## 2024-05-22 - [ClipperLib Object Reuse]
**Learning:** `ClipperLib` operations and path creation in loops can generate massive GC pressure. Reusing path arrays and updating coordinates in-place significantly reduces allocations in grid search algorithms.
**Action:** When performing grid-based geometric checks with `ClipperLib`, lift path creation out of the loop and update coordinates in-place.
