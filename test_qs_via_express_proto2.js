import express from 'express';
import request from 'supertest';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.post('/test', (req, res) => {
    // Check if {} is polluted globally
    console.log('({}).polluted:', ({}).polluted);
    res.json({ ok: true });
});

request(app)
    .post('/test')
    .send('__proto__[polluted]=yes')
    .end(() => process.exit(0));
