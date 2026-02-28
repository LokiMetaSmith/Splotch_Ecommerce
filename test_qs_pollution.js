import qs from 'qs';
// Try qs pollution
const obj = qs.parse('__proto__[polluted]=yes', { allowPrototypes: true });
console.log('allowPrototypes:', obj);
console.log('({}).polluted:', ({}).polluted);

const obj2 = qs.parse('__proto__[polluted]=yes');
console.log('default:', obj2);
console.log('({}).polluted:', ({}).polluted);
