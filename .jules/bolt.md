## 2026-02-28 - [Cache File Reading with mtimeMs]
**Learning:** When adding file-system caching (e.g., caching parsed dimensions for SVG uploads to avoid repeated `fs.promises.readFile`), using the raw `filePath` as a cache key is unsafe if the server processes can overwrite files in place. Stale dimension data could lead to wrong price calculations.
**Action:** Always combine the `filePath` and the file's modification time (`stat.mtimeMs`) via `fs.promises.stat` to create a robust cache key (e.g., `const cacheKey = \`${filePath}_${stat.mtimeMs}\`;`).
