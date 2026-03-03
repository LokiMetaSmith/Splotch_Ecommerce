import express from 'express';
import request from 'supertest';
import { wafMiddleware } from './server/waf.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.post('/test', (req, res) => {
    console.log(Object.keys(req.body));
    console.log(Object.getOwnPropertyNames(req.body));
    res.json({ ok: true });
});

request(app)
    .post('/test')
    .send('__proto__[admin]=true')
    .end((err, res) => {
        console.log(res.status); // 200
    });
