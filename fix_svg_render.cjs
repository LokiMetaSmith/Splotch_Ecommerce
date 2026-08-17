const fs = require('fs');
let content = fs.readFileSync('src/index.js', 'utf8');

// Fix 1: The currentBounds variable might be out of sync. We should use the raw SVG bounds if possible or fallback correctly, and account for bounds offsets.
// Since the previous fix had a problem where tempCanvas dimensions were drawn without offset. Let's fix the drawing logic for SVG.

const regex = /tempCanvas\.width = currentBounds \? currentBounds\.width : 500;\n\s+tempCanvas\.height = currentBounds \? currentBounds\.height : 500;\n\s+const tempCtx = tempCanvas\.getContext\("2d"\);\n\n\s+\/\/ Render elements\n\s+extractedLayers\[type\]\.forEach\(element => \{\n\s+const poly = parser\.polygonify\(element\);\n\s+if \(poly && poly\.length > 0\) \{\n\s+tempCtx\.beginPath\(\);\n\s+tempCtx\.moveTo\(poly\[0\]\.x, poly\[0\]\.y\);\n\s+for\(let i = 1; i < poly\.length; i\+\+\) \{\n\s+tempCtx\.lineTo\(poly\[i\]\.x, poly\[i\]\.y\);\n\s+\}\n\s+tempCtx\.closePath\(\);\n\s+tempCtx\.fillStyle = 'black'; \/\/ Or whatever fill is suitable for a mask\n\s+tempCtx\.fill\(\);\n\s+\}\n\s+\}\);/;

const replacement = `const allPolys = [];
      extractedLayers[type].forEach(element => {
          const poly = parser.polygonify(element);
          if (poly && poly.length > 0) {
              allPolys.push(poly);
          }
      });

      const layerBounds = getPolygonsBounds(allPolys);
      const targetWidth = layerBounds.width > 0 ? layerBounds.width : (currentBounds ? currentBounds.width : 500);
      const targetHeight = layerBounds.height > 0 ? layerBounds.height : (currentBounds ? currentBounds.height : 500);

      tempCanvas.width = targetWidth;
      tempCanvas.height = targetHeight;
      const tempCtx = tempCanvas.getContext("2d");

      // Render elements, offset by the layer's bounds
      allPolys.forEach(poly => {
          tempCtx.beginPath();
          // Offset the coordinates so they fit within the offscreen canvas
          tempCtx.moveTo(poly[0].x - layerBounds.left, poly[0].y - layerBounds.top);
          for(let i = 1; i < poly.length; i++) {
              tempCtx.lineTo(poly[i].x - layerBounds.left, poly[i].y - layerBounds.top);
          }
          tempCtx.closePath();
          tempCtx.fillStyle = '#000000'; // Standard mask color
          tempCtx.fill();
      });

      // Store the offset so it renders correctly on the main canvas
      newLayer.x = layerBounds.left;
      newLayer.y = layerBounds.top;
      newLayer.width = targetWidth;
      newLayer.height = targetHeight;`;

content = content.replace(regex, replacement);

fs.writeFileSync('src/index.js', content);
