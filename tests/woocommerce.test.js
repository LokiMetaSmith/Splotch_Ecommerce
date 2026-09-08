import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { createWooCommerceRouter } from '../server/woocommerce.js';

describe('WooCommerce REST API v3 Emulation (Pirate Ship Integration)', () => {
  let app;
  let mockDb;
  let mockOrders;
  let mockScheduleEmail;
  let mockScheduleTelegram;
  let testConsumerKey = 'ck_test_123456';
  let testConsumerSecret = 'cs_test_654321';

  beforeEach(() => {
    mockOrders = {
      'order-uuid-1': {
        orderId: 'order-uuid-1',
        wcId: 1001,
        amount: 2500, // $25.00
        currency: 'USD',
        status: 'ACCEPTED',
        receivedAt: '2026-09-08T10:00:00.000Z',
        orderDetails: {
          quantity: 50,
          material: 'Glossy Vinyl'
        },
        billingContact: {
          givenName: 'John',
          familyName: 'Doe',
          email: 'john@example.com',
          phoneNumber: '555-1234'
        },
        shippingContact: {
          givenName: 'John',
          familyName: 'Doe',
          email: 'john@example.com',
          phoneNumber: '555-1234',
          addressLines: ['123 Main St', 'Apt 4B'],
          locality: 'Austin',
          administrativeDistrictLevel1: 'TX',
          postalCode: '78701',
          country: 'US'
        }
      },
      'order-uuid-2': {
        orderId: 'order-uuid-2',
        wcId: 1002,
        amount: 5000,
        currency: 'USD',
        status: 'SHIPPED',
        trackingNumber: '9400100000000000000000',
        courier: 'USPS',
        receivedAt: '2026-09-07T12:00:00.000Z',
        billingContact: {
          givenName: 'Jane',
          familyName: 'Smith',
          email: 'jane@example.com'
        },
        shippingContact: {
          givenName: 'Jane',
          familyName: 'Smith',
          addressLines: ['456 Elm St'],
          locality: 'Denver',
          administrativeDistrictLevel1: 'CO',
          postalCode: '80201',
          country: 'US'
        }
      }
    };

    mockDb = {
      data: {
        config: {
          woocommerce: {
            consumerKey: testConsumerKey,
            consumerSecret: testConsumerSecret
          }
        }
      },
      getAllOrders: jest.fn(async () => Object.values(mockOrders)),
      getOrder: jest.fn(async (id) => mockOrders[id]),
      updateOrder: jest.fn(async (order) => {
        mockOrders[order.orderId] = order;
        return order;
      })
    };

    mockScheduleEmail = jest.fn(async () => {});
    mockScheduleTelegram = jest.fn(async () => {});

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const wooModule = createWooCommerceRouter({
      db: mockDb,
      scheduleEmail: mockScheduleEmail,
      scheduleTelegram: mockScheduleTelegram,
      getSecret: (key) => {
        if (key === 'WOOCOMMERCE_CONSUMER_KEY') return testConsumerKey;
        if (key === 'WOOCOMMERCE_CONSUMER_SECRET') return testConsumerSecret;
        return null;
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    });

    app.use(wooModule.router);
  });

  describe('Discovery & System Status', () => {
    it('should return discovery info on GET /wp-json', async () => {
      const res = await request(app).get('/wp-json');
      expect(res.status).toBe(200);
      expect(res.body.namespaces).toContain('wc/v3');
      expect(res.body.namespaces).toContain('wc-shipment-tracking/v3');
    });

    it('should return namespace info on GET /wp-json/wc/v3', async () => {
      const res = await request(app).get('/wp-json/wc/v3');
      expect(res.status).toBe(200);
      expect(res.body.namespace).toBe('wc/v3');
    });

    it('should reject unauthenticated requests to system_status', async () => {
      const res = await request(app).get('/wp-json/wc/v3/system_status');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('woocommerce_rest_cannot_view');
    });

    it('should authenticate system_status with valid Basic Auth', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/system_status')
        .auth(testConsumerKey, testConsumerSecret);
      expect(res.status).toBe(200);
      expect(res.body.environment.version).toBe('8.5.0');
    });

    it('should authenticate system_status with query parameters', async () => {
      const res = await request(app)
        .get(`/wp-json/wc/v3/system_status?consumer_key=${testConsumerKey}&consumer_secret=${testConsumerSecret}`);
      expect(res.status).toBe(200);
      expect(res.body.environment.version).toBe('8.5.0');
    });
  });

  describe('Orders Listing & Retrieval', () => {
    it('should list processing orders for Pirate Ship by default or status=processing', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/orders?status=processing')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(1001);
      expect(res.body[0].status).toBe('processing');
      expect(res.body[0].total).toBe('25.00');
      expect(res.body[0].shipping.address_1).toBe('123 Main St');
      expect(res.body[0].shipping.address_2).toBe('Apt 4B');
      expect(res.body[0].shipping.city).toBe('Austin');
      expect(res.body[0].shipping.state).toBe('TX');
      expect(res.body[0].shipping.postcode).toBe('78701');
      expect(res.headers['x-wp-total']).toBe('1');
    });

    it('should list completed orders when filtering by status=completed', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/orders?status=completed')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(1002);
      expect(res.body[0].status).toBe('completed');
    });

    it('should retrieve a single order by numeric ID', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/orders/1001')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1001);
      expect(res.body.number).toBe('1001');
    });

    it('should retrieve a single order by UUID string', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/orders/order-uuid-1')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1001);
    });

    it('should return 404 for unknown order ID', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v3/orders/999999')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('woocommerce_rest_shop_order_invalid_id');
    });
  });

  describe('Order Status & Tracking Updates', () => {
    it('should update status to SHIPPED when Pirate Ship sends PUT with status=completed', async () => {
      const res = await request(app)
        .put('/wp-json/wc/v3/orders/1001')
        .auth(testConsumerKey, testConsumerSecret)
        .send({ status: 'completed' });

      expect(res.status).toBe(200);
      expect(mockOrders['order-uuid-1'].status).toBe('SHIPPED');
      expect(mockDb.updateOrder).toHaveBeenCalled();
    });

    it('should extract USPS tracking number and courier from Pirate Ship order note and send email', async () => {
      const uspsTracking = '9400111899562537624641';
      const notePayload = {
        note: `Pirate Ship: USPS Tracking Number: ${uspsTracking} (Priority Mail)`,
        customer_note: true
      };

      const res = await request(app)
        .post('/wp-json/wc/v3/orders/1001/notes')
        .auth(testConsumerKey, testConsumerSecret)
        .send(notePayload);

      expect(res.status).toBe(201);
      expect(res.body.author).toBe('Pirate Ship');
      expect(mockOrders['order-uuid-1'].trackingNumber).toBe(uspsTracking);
      expect(mockOrders['order-uuid-1'].courier).toBe('USPS');
      expect(mockOrders['order-uuid-1'].status).toBe('SHIPPED');
      expect(mockScheduleEmail).toHaveBeenCalledWith(
        'send-shipping-email',
        expect.objectContaining({
          to: 'john@example.com',
          subject: expect.stringContaining('order #order-uuid-1 has shipped')
        })
      );
    });

    it('should extract UPS tracking number from order note', async () => {
      const upsTracking = '1Z9999999999999999';
      const notePayload = {
        note: `Shipped via UPS Ground. Tracking: ${upsTracking}`
      };

      const res = await request(app)
        .post('/wp-json/wc/v3/orders/1001/notes')
        .auth(testConsumerKey, testConsumerSecret)
        .send(notePayload);

      expect(res.status).toBe(201);
      expect(mockOrders['order-uuid-1'].trackingNumber).toBe(upsTracking);
      expect(mockOrders['order-uuid-1'].courier).toBe('UPS');
    });

    it('should support WooCommerce Shipment Tracking plugin endpoint', async () => {
      const trackingPayload = {
        tracking_provider: 'fedex',
        tracking_number: '794828192834',
        date_shipped: '2026-09-08'
      };

      const res = await request(app)
        .post('/wp-json/wc-shipment-tracking/v3/orders/1001/shipment-trackings')
        .auth(testConsumerKey, testConsumerSecret)
        .send(trackingPayload);

      expect(res.status).toBe(201);
      expect(res.body.tracking_number).toBe('794828192834');
      expect(mockOrders['order-uuid-1'].trackingNumber).toBe('794828192834');
      expect(mockOrders['order-uuid-1'].courier).toBe('fedex');
      expect(mockOrders['order-uuid-1'].status).toBe('SHIPPED');
      expect(mockScheduleEmail).toHaveBeenCalled();
    });
  });

  describe('OAuth Authorize Endpoint', () => {
    it('should render HTML authorization page on GET /wc-auth/v1/authorize', async () => {
      const res = await request(app)
        .get('/wc-auth/v1/authorize?app_name=Pirate+Ship&return_url=https://ship.pirateship.com/callback&user_id=42');

      expect(res.status).toBe(200);
      expect(res.text).toContain('Connect to Pirate Ship');
      expect(res.text).toContain('action="/wc-auth/v1/authorize"');
    });
  });

  describe('WordPress Discovery & Version Parity (v1 / v2 / v3 / RSD)', () => {
    it('should return authentic schema on GET /wp-json/wc/v1 with Link header', async () => {
      const res = await request(app).get('/wp-json/wc/v1');
      expect(res.status).toBe(200);
      expect(res.headers['link']).toContain('rel="https://api.w.org/"');
      expect(res.body.namespace).toBe('wc/v1');
      expect(res.body.routes).toBeDefined();
      expect(res.body.routes['/wc/v1/orders']).toBeDefined();
      expect(res.body.routes['/wc/v1/orders'].endpoints).toBeDefined();
      expect(res.body._links?.up).toBeDefined();
    });

    it('should support orders listing on GET /wp-json/wc/v1/orders with auth', async () => {
      const res = await request(app)
        .get('/wp-json/wc/v1/orders')
        .auth(testConsumerKey, testConsumerSecret);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.headers['x-wp-total']).toBeDefined();
    });

    it('should return RSD XML on GET /xmlrpc.php', async () => {
      const res = await request(app).get('/xmlrpc.php');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toContain('<rsd version="1.0"');
      expect(res.text).toContain('api name="WP-API"');
    });
  });
});
