# Bolt's Journal

This journal tracks critical performance learnings, anti-patterns, and insights specific to this codebase.

## 2024-05-23 - Parallelizing Shipment Tracking
**Learning:** The shipment tracker was processing orders sequentially using `await` in a loop, which is inefficient for network-bound operations.
**Action:** Replaced sequential loop with `Promise.allSettled` to parallelize API requests. This significantly reduces total polling time.
**Note:** `lowdb` writes the entire state to disk. Batching writes is crucial when parallelizing logic that modifies the DB to avoid race conditions or excessive I/O.

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

## 2026-02-19 - [Memoization with WeakMap]
**Learning:** When memoizing derived data based on large objects (like arrays of points) in a long-lived module scope, using strong references (e.g. `lastInputRef`) can cause memory leaks if the input object is replaced but not garbage collected. Using `WeakMap` allows caching results associated with an object without preventing its garbage collection.
**Action:** Use `WeakMap` for memoization caches where the key is an object and the cache lifespan is indefinite or tied to the module.

## 2026-02-23 - [Pre-Simplification for Topology Checks]
**Learning:** Checking containment (`isPointInPolygon`) on raw, high-resolution contours is O(N*M) where M is huge (e.g., 5000+ points). Simplifying contours using RDP *before* topological checks reduces M drastically (e.g., to ~100 points), making the N*M check negligible (0.2ms vs 48ms) without sacrificing significant accuracy for "hole vs island" detection.
**Action:** When performing geometric relation checks (like containment or intersection) on dense polygons, always simplify them first if perfect precision is not required.

## 2026-02-23 - [ClipperLib Coordinate Case Sensitivity]
**Learning:** `ClipperLib` uses uppercase `X` and `Y` properties for points. Accessing `point.y` (lowercase) returns `undefined`, leading to `NaN` in calculations. This silent failure in map/transform functions can be hard to spot if downstream consumers handle `NaN` gracefully (or if the feature just silently breaks).
**Action:** Always verify property casing when working with external libraries, especially those ported from other languages (like C# or C++), which often use PascalCase.

## 2026-02-24 - [Point in Polygon Optimization]
**Learning:** Floating-point division is significantly slower than multiplication (latency 10-20 cycles vs 3-4). In geometric containment checks (ray casting), the inequality `point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi` can be rewritten as a cross-multiplication `(point.x - xi) * (yj - yi) < (xj - xi) * (point.y - yi)` (handling sign of dy), yielding ~29% speedup.
**Action:** When optimizing geometric predicates, look for opportunities to replace division with multiplication using algebraic rearrangement, especially in hot loops.

## 2026-02-28 - [Cache File Reading with mtimeMs]
**Learning:** When adding file-system caching (e.g., caching parsed dimensions for SVG uploads to avoid repeated `fs.promises.readFile`), using the raw `filePath` as a cache key is unsafe if the server processes can overwrite files in place. Stale dimension data could lead to wrong price calculations.
**Action:** Always combine the `filePath` and the file's modification time (`stat.mtimeMs`) via `fs.promises.stat` to create a robust cache key (e.g., `const cacheKey = \`${filePath}_${stat.mtimeMs}\`;`).
## 2026-03-01 - [Fast Perimeter Calculation]
**Learning:** The `calculatePerimeter` function (used for pricing based on complexity tiers) was inefficiently calculating polygon perimeters by creating a closure `distance()` for every point and repeatedly doing bounds and type checks inside array iteration (`forEach`). Iterating with a normal `for` loop and tracking previous validity states cut computation time by ~50%.
**Action:** Replaced `forEach` and closures with a traditional `for` loop, eliminating array accesses via modulo and unneeded redundant checks.

## 2026-03-02 - [SVG Path Generation String Builder]
**Learning:** In `generateSvgFromCutline`, generating the `d` attribute of an SVG `<path>` by repeatedly appending strings (e.g., `pathD += "M ..."` and `pathD += "L ..."`) inside a loop for thousands of polygon points is highly inefficient. It creates massive Garbage Collection (GC) pressure by constantly creating and discarding new string objects for each concatenation step.
**Action:** Replace string concatenation inside tight geometry processing loops with a pre-allocated Array and use `.join(' ')`. For `generateSvgFromCutline`, this improved SVG generation speed by ~15-20%. Calculate the required array size (`total points + number of polygons`) beforehand to avoid dynamic array resizing overhead.

## 2026-03-05 - [Jimp Buffer Iteration]
**Learning:** `Jimp.scan()` uses a callback function per pixel, which creates immense overhead (e.g., millions of function calls for large images). Replacing it with a raw `for` loop over the underlying `Buffer` (`image.bitmap.data`) dramatically improves ink coverage/pixel calculation times by eliminating callback allocation and invocation.
**Action:** Use direct `Uint8Array`/`Buffer` iteration instead of `Jimp.scan()` when performing pixel-level analysis in Node.js.

## 2026-03-05 - [Jimp Buffer Iteration Uint32Array]
**Learning:** Iterating over a Node.js Buffer (or `Uint8Array`) using `Uint32Array` allows processing 4 bytes (RGBA channels) in a single CPU instruction using bitwise operators. This eliminates 75% of array access overhead and speeds up calculations (like ink coverage) by an additional ~1.3-1.7x compared to byte-by-byte traversal.
**Action:** When performing pixel-level analysis where individual channel values can be extracted via bitwise shifts, cast the `Buffer` to a `Uint32Array` after checking system endianness.

## 2026-03-10 - [Nested Map Array Allocation]
**Learning:** In performance-critical hot paths for array transformations (like scaling or rotating large sets of polygon coordinates), using nested `Array.prototype.map()` calls creates significant Garbage Collection (GC) pressure and function call overhead.
**Action:** Replace nested `.map()` or `.forEach()` calls with pre-allocated arrays (`new Array(length)`) and standard bounded `for` loops. This avoids dynamic array resizing and callback allocations, significantly improving execution time (e.g. ~3x faster for large geometry datasets).
