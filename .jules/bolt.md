## 2026-02-28 - [Cache File Reading with mtimeMs]
**Learning:** When adding file-system caching (e.g., caching parsed dimensions for SVG uploads to avoid repeated `fs.promises.readFile`), using the raw `filePath` as a cache key is unsafe if the server processes can overwrite files in place. Stale dimension data could lead to wrong price calculations.
**Action:** Always combine the `filePath` and the file's modification time (`stat.mtimeMs`) via `fs.promises.stat` to create a robust cache key (e.g., `const cacheKey = \`${filePath}_${stat.mtimeMs}\`;`).
## 2026-03-01 - [Fast Perimeter Calculation]
**Learning:** The `calculatePerimeter` function (used for pricing based on complexity tiers) was inefficiently calculating polygon perimeters by creating a closure `distance()` for every point and repeatedly doing bounds and type checks inside array iteration (`forEach`). Iterating with a normal `for` loop and tracking previous validity states cut computation time by ~50%.
**Action:** Replaced `forEach` and closures with a traditional `for` loop, eliminating array accesses via modulo and unneeded redundant checks.
