import express from 'express';
import request from 'supertest';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.post('/test', (req, res) => {
    // What if we do constructor.prototype
    console.log('({}).polluted:', ({}).polluted);
    res.json({ ok: true });
});

request(app)
    .post('/test')
    .send('constructor[prototype][polluted]=yes')
    .end(() => process.exit(0));
