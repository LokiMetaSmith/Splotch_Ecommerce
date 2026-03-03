import express from 'express';
import request from 'supertest';
import { wafMiddleware } from './server/waf.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(wafMiddleware);
app.post('/test', (req, res) => {
    res.json({ ok: true });
});

request(app)
    .post('/test')
    .send('constructor=123')
    .end((err, res) => {
        console.log(res.status); // Expect 403
        process.exit(0);
    });
