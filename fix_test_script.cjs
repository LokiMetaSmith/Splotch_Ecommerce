const fs = require('fs');
let pkg = require('./server/package.json');
pkg.scripts.test = "cross-env NODE_OPTIONS='--max-old-space-size=4096' node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --workerIdleMemoryLimit=512MB";
fs.writeFileSync('./server/package.json', JSON.stringify(pkg, null, 2));

let rootPkg = require('./package.json');
rootPkg.scripts['test:unit'] = "cross-env NODE_OPTIONS='--max-old-space-size=4096' node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --workerIdleMemoryLimit=512MB";
fs.writeFileSync('./package.json', JSON.stringify(rootPkg, null, 2));
