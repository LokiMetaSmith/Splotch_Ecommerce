import { wafMiddleware } from './server/waf.js';

let payload = {};
for (let i = 0; i < 10000; i++) {
    payload[`key${i}`] = `value${i}`;
}

const req = {
    query: {},
    body: payload,
    url: '/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
};

const res = {
    status: function(code) { console.log('STATUS:', code); return this; },
    json: function(data) { console.log('JSON:', data); return this; }
};

const next = () => console.log('NEXT CALLED');

console.time('waf_with_keys');
wafMiddleware(req, res, next);
console.timeEnd('waf_with_keys');
