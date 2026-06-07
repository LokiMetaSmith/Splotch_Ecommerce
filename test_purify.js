const DOMPurify = require('isomorphic-dompurify');
const svg = `<svg width="100px" height="200px" viewBox="0 0 100 200"><rect width="10" height="10"/></svg>`;
console.log(DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } }));
