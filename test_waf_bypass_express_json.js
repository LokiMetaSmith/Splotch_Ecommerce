import express from 'express';
import request from 'supertest';

const app = express();
app.use(express.json());
app.post('/test', (req, res) => {
    console.log('req.body.__proto__:', req.body.__proto__);
    console.log('Object.keys(req.body):', Object.keys(req.body));
    console.log('Object.getOwnPropertyNames(req.body):', Object.getOwnPropertyNames(req.body));
    const keys = [];
    for (const key in req.body) {
        if (Object.prototype.hasOwnProperty.call(req.body, key)) {
            keys.push(key);
        }
    }
    console.log('hasOwnProperty keys:', keys);
    res.json({ ok: true });
});

request(app)
    .post('/test')
    .send('{"__proto__":{"polluted":"yes"}}')
    .set('Content-Type', 'application/json')
    .end(() => process.exit(0));
