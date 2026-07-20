// src/lib/layers.js

export let designLayers = [];
export let activeLayerIndex = -1;

export function addLayer(image, name, x, y, width, height) {
  const newLayer = {
    id: `layer_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    image: image,
    name: name || `Layer ${designLayers.length + 1}`,
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
  };
  designLayers.push(newLayer);
  activeLayerIndex = designLayers.length - 1;
  return newLayer;
}

export function removeLayer(index) {
  if (index >= 0 && index < designLayers.length) {
    designLayers.splice(index, 1);
    if (activeLayerIndex === index) {
      activeLayerIndex = designLayers.length > 0 ? designLayers.length - 1 : -1;
    } else if (activeLayerIndex > index) {
      activeLayerIndex--;
    }
    return true;
  }
  return false;
}

export function moveLayer(fromIndex, toIndex) {
  if (fromIndex >= 0 && fromIndex < designLayers.length && toIndex >= 0 && toIndex < designLayers.length) {
    const [layer] = designLayers.splice(fromIndex, 1);
    designLayers.splice(toIndex, 0, layer);
    
    // Update activeLayerIndex
    if (activeLayerIndex === fromIndex) {
      activeLayerIndex = toIndex;
    } else if (activeLayerIndex > fromIndex && activeLayerIndex <= toIndex) {
      activeLayerIndex--;
    } else if (activeLayerIndex < fromIndex && activeLayerIndex >= toIndex) {
      activeLayerIndex++;
    }
    return true;
  }
  return false;
}

export function setActiveLayer(index) {
  if (index >= -1 && index < designLayers.length) {
    activeLayerIndex = index;
    return true;
  }
  return false;
}

export function getLayers() {
  return designLayers;
}

export function getActiveLayer() {
  if (activeLayerIndex >= 0 && activeLayerIndex < designLayers.length) {
    return designLayers[activeLayerIndex];
  }
  return null;
}

export function clearLayers() {
  designLayers = [];
  activeLayerIndex = -1;
}
