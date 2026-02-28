import qs from 'qs';
const parsed = qs.parse('constructor[prototype][polluted]=yes');
console.log('parsed constructor:', parsed.constructor);
console.log('Object.keys(parsed):', Object.keys(parsed));
console.log('Object.getOwnPropertyNames(parsed):', Object.getOwnPropertyNames(parsed));
for (const key in parsed) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        console.log('hasOwnProperty key:', key);
    }
}
