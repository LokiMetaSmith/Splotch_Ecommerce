export function generateCutFile(svgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = doc.documentElement;
    const cutFileSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cutFileSvg.setAttribute('width', svgElement.getAttribute('width'));
    cutFileSvg.setAttribute('height', svgElement.getAttribute('height'));
    cutFileSvg.setAttribute('viewBox', svgElement.getAttribute('viewBox'));

    // Support multiple shapes
    svgElement.querySelectorAll('path, rect, circle, ellipse, polygon, polyline').forEach(el => {
        const newEl = el.cloneNode(true);
        newEl.setAttribute('stroke', 'red');
        newEl.setAttribute('fill', 'none');
        cutFileSvg.appendChild(newEl);
    });

    return new XMLSerializer().serializeToString(cutFileSvg);
}
