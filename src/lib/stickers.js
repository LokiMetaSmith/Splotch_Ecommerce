// src/lib/stickers.js

export let stickers = [];
export let activeStickerIndex = -1;

export function addSticker(image, name, x, y, width, height) {
  const newSticker = {
    id: `sticker_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    image: image,
    name: name || `Sticker ${stickers.length + 1}`,
    x: x,
    y: y,
    width: width,
    height: height,
    rotation: 0,
    scale: 1,
    cutlinePoly: null,
    offsetPoly: null,
    cleanCanvasState: null, // Used if there are filters
    customLayers: [],
    basePolygons: [],
    currentPolygons: [],
    currentCutline: [],
    rasterCutlinePoly: null,
    cutlineOffset: 15,
    cutlineSensitivity: 42,
    lazyLassoRadius: 50,
    isGrayscale: false,
    isSepia: false
  };
  stickers.push(newSticker);
  activeStickerIndex = stickers.length - 1;
  return newSticker;
}

export function removeSticker(index) {
  if (index >= 0 && index < stickers.length) {
    stickers.splice(index, 1);
    if (activeStickerIndex === index) {
      activeStickerIndex = stickers.length > 0 ? stickers.length - 1 : -1;
    } else if (activeStickerIndex > index) {
      activeStickerIndex--;
    }
    return true;
  }
  return false;
}

export function moveSticker(fromIndex, toIndex) {
  if (fromIndex >= 0 && fromIndex < stickers.length && toIndex >= 0 && toIndex < stickers.length) {
    const [sticker] = stickers.splice(fromIndex, 1);
    stickers.splice(toIndex, 0, sticker);

    // Update activeStickerIndex
    if (activeStickerIndex === fromIndex) {
      activeStickerIndex = toIndex;
    } else if (activeStickerIndex > fromIndex && activeStickerIndex <= toIndex) {
      activeStickerIndex--;
    } else if (activeStickerIndex < fromIndex && activeStickerIndex >= toIndex) {
      activeStickerIndex++;
    }
    return true;
  }
  return false;
}

export function setActiveSticker(index) {
  if (index === 'boundary' || (index >= -1 && index < stickers.length)) {
    activeStickerIndex = index;
    return true;
  }
  return false;
}

export function getStickers() {
  return stickers;
}

export function getActiveSticker() {
  if (activeStickerIndex >= 0 && activeStickerIndex < stickers.length) {
    return stickers[activeStickerIndex];
  }
  return null;
}

export function clearStickers() {
  stickers = [];
  activeStickerIndex = -1;
}
