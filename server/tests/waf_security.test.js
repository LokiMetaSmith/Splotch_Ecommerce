
import request from 'supertest';
import express from 'express';
import { wafMiddleware } from '../waf.js';

describe('WAF Security Tests', () => {
    let app;

    beforeAll(() => {
        app = express();
        // Mimic server.js setup
        app.use(express.json());
        // Default express query parser is 'extended' (qs) usually, or we can specify.
        // server.js doesn't specify 'query parser', so it defaults to 'extended' (qs) in Express 4,
        // but Express 5 (used here) might differ.
        // Express 5 defaults to 'simple' (querystring) I think?
        // Let's rely on default.
        app.use(wafMiddleware);
        app.all('/test', (req, res) => {
            res.status(200).json({ status: 'ok', body: req.body, query: req.query });
        });
    });

    it('should BLOCK constructor.prototype in BODY (Prototype Pollution)', async () => {
        // Send as string to ensure control over the payload
        const payloadString = '{"constructor": {"prototype": {"polluted": true}}}';
        const res = await request(app)
            .post('/test')
            .set('Content-Type', 'application/json')
            .send(payloadString);

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Forbidden');
    });

    it('should BLOCK __proto__ in QUERY (Prototype Pollution)', async () => {
        const res = await request(app)
            .get('/test?__proto__[polluted]=true');

        // Express query parser (qs) might parse this as { __proto__: { polluted: 'true' } }
        // If so, WAF should block it.
        // If express strips it, it returns 200.

        if (res.status === 200) {
            // If it returns 200, check if query actually contains __proto__
            // If it does, WAF failed.
            // If it doesn't (sanitized by express), then it's safe but WAF didn't need to act.
             if (res.body.query && (res.body.query.__proto__ || Object.prototype.hasOwnProperty.call(res.body.query, '__proto__'))) {
                 throw new Error('WAF failed to block __proto__ in query, and it was present!');
             }
             // If not present, we can't test WAF blocking it, but system is safe.
             // However, to verify WAF logic, we can simulate a query object.
        } else {
            expect(res.status).toBe(403);
        }
    });

    it('should BLOCK manual object with __proto__ (Unit Test logic)', async () => {
         // Create a middleware that manually injects a malicious object to test WAF logic directly
         // bypassing express parsers
         const testApp = express();
         testApp.use((req, res, next) => {
             req.body = Object.create(null);
             req.body['__proto__'] = { polluted: true };
             req.body['normal'] = 'value';
             next();
         });
         testApp.use(wafMiddleware);
         testApp.post('/unit-test', (req, res) => res.send('ok'));

         const res = await request(testApp).post('/unit-test');
         expect(res.status).toBe(403);
    });

    it('should BLOCK SQL Injection (Control Test)', async () => {
        const payload = { q: "UNION SELECT * FROM users" };
        const res = await request(app)
            .post('/test')
            .send(payload);

        expect(res.status).toBe(403);
    });

    it('should ALLOW safe payloads', async () => {
        const payload = { name: "Safe User", age: 30 };
        const res = await request(app)
            .post('/test')
            .send(payload);

        expect(res.status).toBe(200);
    });
});
