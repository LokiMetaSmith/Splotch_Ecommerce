import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_UPLOADS_DIR = path.resolve(__dirname, "../uploads");

/**
 * Generates a standardized multi-layer production SVG with White Underbase,
 * Kiss-Cut, and Die-Cut layers matching Roland / VinylMaster print shop standards.
 *
 * @param {object} options
 * @param {string} options.artworkPath - Public /uploads/... path or absolute path
 * @param {number} options.widthInches - Sticker width in inches
 * @param {number} options.heightInches - Sticker height in inches
 * @param {string} [options.cutType="die_cut"] - "die_cut" or "kiss_cut"
 * @param {string} [options.material="vinyl_matte"]
 * @param {string} [options.uploadsDir]
 * @returns {Promise<{ cutLinePath: string, widthPx: number, heightPx: number }>}
 */
export async function generateProductionCutlineSvg({
  artworkPath,
  widthInches = 2.0,
  heightInches = 2.0,
  cutType = "die_cut",
  material = "vinyl_matte",
  uploadsDir = DEFAULT_UPLOADS_DIR
}) {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const wIn = parseFloat(widthInches) || 2.0;
  const hIn = parseFloat(heightInches) || 2.0;
  const dpi = 96; // Standard SVG screen DPI
  const widthPx = Math.round(wIn * dpi);
  const heightPx = Math.round(hIn * dpi);

  // Bleed and border margins in pixels
  const kissCutRadius = 8;
  const dieCutMargin = cutType === "die_cut" ? 8 : 0;
  const totalWidthPx = widthPx + (dieCutMargin * 2);
  const totalHeightPx = heightPx + (dieCutMargin * 2);

  // Locate the physical artwork file on disk
  let localArtPath = artworkPath;
  if (artworkPath.startsWith("/uploads/")) {
    localArtPath = path.join(uploadsDir, path.basename(artworkPath));
  } else if (!path.isAbsolute(artworkPath)) {
    localArtPath = path.join(uploadsDir, artworkPath);
  }

  let artContent = "";
  let isSvg = false;
  let base64ImageUri = "";

  if (fs.existsSync(localArtPath)) {
    const ext = path.extname(localArtPath).toLowerCase();
    if (ext === ".svg") {
      isSvg = true;
      artContent = await fs.promises.readFile(localArtPath, "utf8");
    } else {
      const imgBuffer = await fs.promises.readFile(localArtPath);
      let mime = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
      else if (ext === ".webp") mime = "image/webp";
      base64ImageUri = `data:${mime};base64,${imgBuffer.toString("base64")}`;
    }
  }

  // Construct production cutline SVG with dedicated top-level layers
  const artX = dieCutMargin;
  const artY = dieCutMargin;

  // Layer 1: White_Layer (Underbase)
  const whiteLayerXml = `
  <g id="White_Layer" inkscape:label="White_Layer" style="display:inline;">
    <rect x="${artX}" y="${artY}" width="${widthPx}" height="${heightPx}" rx="${kissCutRadius}" ry="${kissCutRadius}" fill="#FFFFFF" stroke="none" />
  </g>`;

  // Layer 2: Cmyk_art_Layer (Artwork)
  let cmykLayerXml = "";
  if (isSvg && artContent) {
    // Strip XML decl and outer <svg> tag for clean embedding
    let innerSvg = artContent
      .replace(/<\?xml[^>]*\?>/i, "")
      .replace(/<!DOCTYPE[^>]*>/i, "")
      .replace(/<svg[^>]*>/i, "")
      .replace(/<\/svg>/i, "");
    cmykLayerXml = `
  <g id="Cmyk_art_Layer" inkscape:label="Cmyk_art_Layer">
    <g transform="translate(${artX}, ${artY})">
      ${innerSvg}
    </g>
  </g>`;
  } else if (base64ImageUri) {
    cmykLayerXml = `
  <g id="Cmyk_art_Layer" inkscape:label="Cmyk_art_Layer">
    <image x="${artX}" y="${artY}" width="${widthPx}" height="${heightPx}" href="${base64ImageUri}" preserveAspectRatio="xMidYMid meet" />
  </g>`;
  } else {
    cmykLayerXml = `
  <g id="Cmyk_art_Layer" inkscape:label="Cmyk_art_Layer">
    <rect x="${artX}" y="${artY}" width="${widthPx}" height="${heightPx}" rx="${kissCutRadius}" ry="${kissCutRadius}" fill="#2563EB" />
  </g>`;
  }

  // Layer 3: Kiss-Cut (Contour Cut)
  const kissCutXml = `
  <g id="Kiss-Cut" inkscape:label="Kiss-Cut" style="display:inline;">
    <rect x="${artX}" y="${artY}" width="${widthPx}" height="${heightPx}" rx="${kissCutRadius}" ry="${kissCutRadius}" fill="none" stroke="#00FFFF" stroke-width="0.75" />
  </g>`;

  // Layer 4: Die-Cut (Perforated through-cut perimeter)
  const dieCutXml = cutType === "die_cut" ? `
  <g id="Die-Cut" inkscape:label="Die-Cut" style="display:inline;">
    <rect x="0.5" y="0.5" width="${totalWidthPx - 1}" height="${totalHeightPx - 1}" rx="${kissCutRadius + 4}" ry="${kissCutRadius + 4}" fill="none" stroke="#FF0000" stroke-width="1.0" />
  </g>` : "";

  const fullSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${totalWidthPx}" height="${totalHeightPx}" viewBox="0 0 ${totalWidthPx} ${totalHeightPx}" data-width-inches="${wIn}" data-height-inches="${hIn}" data-cut-type="${cutType}" data-material="${material}">
${whiteLayerXml}
${cmykLayerXml}
${kissCutXml}
${dieCutXml}
</svg>`;

  const filename = `cutLineFile-agent-${Date.now()}-${randomUUID().slice(0, 8)}.svg`;
  const targetPath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(targetPath, fullSvg, "utf8");

  return {
    cutLinePath: `/uploads/${filename}`,
    widthPx: totalWidthPx,
    heightPx: totalHeightPx
  };
}

/**
 * Generates an annotated proof preview SVG for an agent or client proofing workflow.
 *
 * @param {object} options
 * @param {string} options.artworkPath
 * @param {number} options.widthInches
 * @param {number} options.heightInches
 * @param {string} [options.material="vinyl_matte"]
 * @param {string} [options.cutType="die_cut"]
 * @param {string} [options.uploadsDir]
 * @returns {Promise<{ previewUrl: string, widthInches: number, heightInches: number }>}
 */
export async function generateStickerProofSvg({
  artworkPath,
  widthInches = 2.0,
  heightInches = 2.0,
  material = "vinyl_matte",
  cutType = "die_cut",
  uploadsDir = DEFAULT_UPLOADS_DIR
}) {
  const wIn = parseFloat(widthInches) || 2.0;
  const hIn = parseFloat(heightInches) || 2.0;

  let localArtPath = artworkPath;
  if (artworkPath.startsWith("/uploads/")) {
    localArtPath = path.join(uploadsDir, path.basename(artworkPath));
  } else if (!path.isAbsolute(artworkPath)) {
    localArtPath = path.join(uploadsDir, artworkPath);
  }

  let artContent = "";
  let isSvg = false;
  let base64ImageUri = "";

  if (fs.existsSync(localArtPath)) {
    const ext = path.extname(localArtPath).toLowerCase();
    if (ext === ".svg") {
      isSvg = true;
      artContent = await fs.promises.readFile(localArtPath, "utf8");
    } else {
      const imgBuffer = await fs.promises.readFile(localArtPath);
      let mime = "image/png";
      if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
      else if (ext === ".webp") mime = "image/webp";
      base64ImageUri = `data:${mime};base64,${imgBuffer.toString("base64")}`;
    }
  }

  const canvasW = 600;
  const canvasH = 500;
  const stickerMaxW = 380;
  const stickerMaxH = 340;

  // Scale sticker to fit nicely in mockup canvas
  const aspect = wIn / hIn;
  let stickerW = stickerMaxW;
  let stickerH = stickerW / aspect;
  if (stickerH > stickerMaxH) {
    stickerH = stickerMaxH;
    stickerW = stickerH * aspect;
  }
  const stickerX = (canvasW - stickerW) / 2;
  const stickerY = ((canvasH - 80) - stickerH) / 2 + 30;

  let innerArtwork = "";
  if (isSvg && artContent) {
    let clean = artContent
      .replace(/<\?xml[^>]*\?>/i, "")
      .replace(/<!DOCTYPE[^>]*>/i, "")
      .replace(/<svg[^>]*>/i, "")
      .replace(/<\/svg>/i, "");
    innerArtwork = `<g transform="translate(${stickerX}, ${stickerY})">${clean}</g>`;
  } else if (base64ImageUri) {
    innerArtwork = `<image x="${stickerX}" y="${stickerY}" width="${stickerW}" height="${stickerH}" href="${base64ImageUri}" preserveAspectRatio="xMidYMid meet" />`;
  } else {
    innerArtwork = `<rect x="${stickerX}" y="${stickerY}" width="${stickerW}" height="${stickerH}" rx="16" fill="#3B82F6" />`;
  }

  const materialLabel = material === "holographic" ? "Holographic Vinyl" : (material === "vinyl_gloss" ? "Gloss Vinyl" : "Matte Vinyl");
  const cutLabel = cutType === "kiss_cut" ? "Kiss Cut" : "Die Cut";

  const proofSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <defs>
    <!-- Soft Drop Shadow Filter for Realistic Sticker Mockup -->
    <filter id="sticker-shadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#0F172A" flood-opacity="0.18" />
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0F172A" flood-opacity="0.10" />
    </filter>
    <!-- Subtle Vinyl Gloss Highlight -->
    <linearGradient id="vinyl-glare" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.15" />
      <stop offset="40%" stop-color="#FFFFFF" stop-opacity="0.03" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.05" />
    </linearGradient>
  </defs>

  <!-- Modern Studio Mockup Background -->
  <rect width="${canvasW}" height="${canvasH}" fill="#F8FAFC" rx="12" />
  <rect x="1" y="1" width="${canvasW - 2}" height="${canvasH - 2}" fill="none" stroke="#E2E8F0" stroke-width="1.5" rx="11" />

  <!-- Grid Pattern Subtle Underlay -->
  <pattern id="dot-grid" width="20" height="20" patternUnits="userSpaceOnUse">
    <circle cx="10" cy="10" r="1" fill="#CBD5E1" />
  </pattern>
  <rect width="${canvasW}" height="${canvasH - 70}" fill="url(#dot-grid)" opacity="0.6" rx="12" />

  <!-- Sticker Group with Die-Cut Border & Drop Shadow -->
  <g filter="url(#sticker-shadow)">
    <!-- White Die-Cut Vinyl Border -->
    <rect x="${stickerX - 6}" y="${stickerY - 6}" width="${stickerW + 12}" height="${stickerH + 12}" rx="14" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="0.75" />
    <!-- Embedded Artwork -->
    ${innerArtwork}
    <!-- Surface Sheen Overlay -->
    <rect x="${stickerX - 6}" y="${stickerY - 6}" width="${stickerW + 12}" height="${stickerH + 12}" rx="14" fill="url(#vinyl-glare)" pointer-events="none" />
  </g>

  <!-- Footer Information Bar -->
  <rect y="${canvasH - 70}" width="${canvasW}" height="70}" fill="#FFFFFF" rx="0" />
  <line x1="0" y1="${canvasH - 70}" x2="${canvasW}" y2="${canvasH - 70}" stroke="#E2E8F0" stroke-width="1" />

  <text x="24" y="${canvasH - 42}" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#0F172A">
    Splotch Print Proof
  </text>
  <text x="24" y="${canvasH - 22}" font-family="system-ui, -apple-system, sans-serif" font-size="12" fill="#64748B">
    ${wIn}" × ${hIn}" • ${cutLabel}
  </text>

  <!-- Material & Cut Badges -->
  <rect x="${canvasW - 210}" y="${canvasH - 50}" width="95" height="26" rx="6" fill="#EFF6FF" stroke="#BFDBFE" stroke-width="1" />
  <text x="${canvasW - 162}" y="${canvasH - 33}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#1D4ED8" text-anchor="middle">
    ${materialLabel}
  </text>

  <rect x="${canvasW - 105}" y="${canvasH - 50}" width="85" height="26" rx="6" fill="#ECFDF5" stroke="#A7F3D0" stroke-width="1" />
  <text x="${canvasW - 62}" y="${canvasH - 33}" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" fill="#047857" text-anchor="middle">
    ${cutLabel}
  </text>
</svg>`;

  const filename = `preview-agent-${Date.now()}-${randomUUID().slice(0, 8)}.svg`;
  const targetPath = path.join(uploadsDir, filename);
  await fs.promises.writeFile(targetPath, proofSvg, "utf8");

  return {
    previewUrl: `/uploads/${filename}`,
    url: `https://splotch.page/uploads/${filename}`,
    widthInches: wIn,
    heightInches: hIn,
    material,
    cutType
  };
}
