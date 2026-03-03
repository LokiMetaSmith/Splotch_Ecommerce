import { wafMiddleware } from './server/waf.js';

let obj = {};

// Express (qs) parses `__proto__[admin]=true` into an object where `__proto__` is set.
// However, `hasOwnProperty.call(obj, '__proto__')` is false if it's just setting the prototype.
// But wait! If `qs` or `body-parser` sets it, it depends on their internal mechanism.
// `body-parser` uses `JSON.parse`. `JSON.parse('{"__proto__": 1}')` creates an object where `__proto__` IS an own enumerable property!
// Let's test that:
const parsed = JSON.parse('{"__proto__": 1}');
console.log(Object.prototype.hasOwnProperty.call(parsed, "__proto__")); // true

// So JSON body IS protected.
// What about URL encoded body (qs)?
import qs from 'qs';
const parsedQs = qs.parse('__proto__[admin]=true');
console.log(Object.prototype.hasOwnProperty.call(parsedQs, "__proto__")); // false in modern node?
console.log(parsedQs); // Object { admin: 'true' }
console.log(parsedQs.admin); // true
console.log({}.admin); // undefined (qs doesn't pollute Object.prototype directly)

// If `qs` doesn't pollute, it creates an object with `__proto__`?
console.log(Object.keys(parsedQs)); // [ '__proto__' ]
// Ah! If it's in Object.keys, it's enumerable!
// Let's test if our WAF catches it using Object.keys instead of for-in.
