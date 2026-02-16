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

## 2025-02-05 - [Scanline Active List]
**Learning:** In 2D grid-based placement algorithms, checking against *all* placed items for every grid cell is O(W*H*P). filtering items by the current Y-scanline (Active List) reduces the inner loop checks to O(sqrt(P)), providing massive speedups for dense packings.
**Action:** When iterating a grid for collision detection, always maintain a filtered list of "active" colliders relevant to the current row/band.

## 2026-02-07 - [Combined Regex in Loop]
**Learning:** Running multiple regex checks (like WAF patterns) in a loop for every string field is expensive (O(M*N)). combining regex patterns with `|` into a single RegExp reduces the overhead significantly for the "happy path" (no match), improving middleware performance by ~2x.
**Action:** When checking a string against multiple regex patterns, combine them into a single RegExp using `join('|')` to fail fast.

## 2026-02-08 - [Recursive String Concatenation]
**Learning:** Passing a concatenated path string (e.g., `path + '.' + key`) down a recursive object traversal generates a new string for every node, creating significant GC pressure even for benign payloads. Passing an array or reconstructing the path only upon detecting a target avoids this overhead.
**Action:** In recursive validation or traversal functions, avoid passing state that requires allocation (like strings) unless necessary. Return metadata to the caller to reconstruct context if needed.

## 2026-02-09 - [JSON Serialization Fast Path]
**Learning:** Recursively traversing large JSON objects in middleware (like a WAF) to check string values against regex patterns is O(N) where N is the number of nodes. Serializing the object to a JSON string and checking the string once with a combined regex is O(L) where L is the string length, which is much faster due to native C++ implementation of `JSON.stringify` and RegExp engine.
**Action:** When validating complex objects for simple string patterns, consider serializing the object to check for the pattern globally before traversing.

## 2026-02-16 - [SmoothPolygon Allocation]
**Learning:** In high-frequency geometry processing, repeatedly calling `Array.push()` inside a loop causes dynamic array resizing overhead. Pre-allocating the array using `new Array(size)` and assigning by index eliminates this. Also, replacing modulo operator `%` with conditional checks in tight loops yields measurable speedups in JS engines.
**Action:** When processing geometry (points) where the output size is known (e.g. 2x input), pre-allocate result arrays.
