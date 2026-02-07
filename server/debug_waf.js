
import express from 'express';
import request from 'supertest';

const app = express();
app.get('/test/:id', (req, res) => {
    res.json({ path: req.path, url: req.url });
});

request(app)
    .get("/test/admin'%20OR%201=1")
    .expect(200)
    .then(res => {
        console.log('Path:', res.body.path);
        console.log('URL:', res.body.url);
    });
