import { wafMiddleware } from './server/waf.js';

let obj = Object.create(null);
obj.__proto__ = { admin: true };

const req = {
    query: {},
    body: obj,
    url: '/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' }
};

const res = {
    status: function(code) { console.log('STATUS:', code); return this; },
    json: function(data) { console.log('JSON:', data); return this; }
};

const next = () => console.log('NEXT CALLED');

wafMiddleware(req, res, next);
