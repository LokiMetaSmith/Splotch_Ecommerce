import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { escapeHtml } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let wcV1Schema = null;
let wcV3Schema = null;

try {
  const v1Path = path.join(__dirname, 'data', 'wc_v1_schema.json');
  if (fs.existsSync(v1Path)) {
    wcV1Schema = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
  }
} catch (e) {
  // Ignored if missing
}

try {
  const v3Path = path.join(__dirname, 'data', 'wc_v3_schema.json');
  if (fs.existsSync(v3Path)) {
    wcV3Schema = JSON.parse(fs.readFileSync(v3Path, 'utf8'));
  }
} catch (e) {
  // Ignored if missing
}

/**
 * Creates and configures the WooCommerce REST API emulation router.
 *
 * @param {Object} options
 * @param {Object} options.db LowDb / database adapter
 * @param {Function} options.scheduleEmail email scheduler
 * @param {Function} options.scheduleTelegram telegram scheduler
 * @param {Function} options.getSecret secret accessor
 * @param {Object} options.logger logger instance
 * @param {Object} [options.bot] telegraf bot instance
 * @returns {Object} { router, getCredentials, parseTrackingInfo, splotchToWooOrder }
 */
export function createWooCommerceRouter({ db, scheduleEmail, scheduleTelegram, getSecret, logger, bot }) {
  const router = express.Router();

  // Helper to retrieve active consumer key and secret
  function getCredentials() {
    let key = getSecret('WOOCOMMERCE_CONSUMER_KEY') || getSecret('PIRATESHIP_CONSUMER_KEY');
    let secret = getSecret('WOOCOMMERCE_CONSUMER_SECRET') || getSecret('PIRATESHIP_CONSUMER_SECRET');

    // Check database config if not provided in environment
    if (db.data?.config?.woocommerce) {
      if (db.data.config.woocommerce.consumerKey) {
        key = db.data.config.woocommerce.consumerKey;
      }
      if (db.data.config.woocommerce.consumerSecret) {
        secret = db.data.config.woocommerce.consumerSecret;
      }
    }

    // Default fallback if unset
    if (!key) key = 'ck_splotch_default_key';
    if (!secret) secret = 'cs_splotch_default_secret';

    return { consumerKey: key, consumerSecret: secret };
  }

  // Middleware: Authenticate WooCommerce requests via Basic Auth or Query String
  function authenticateWooCommerce(req, res, next) {
    const { consumerKey, consumerSecret } = getCredentials();

    let clientKey = '';
    let clientSecret = '';

    // Check Basic Auth header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Basic ')) {
      try {
        const credentials = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const colonIndex = credentials.indexOf(':');
        if (colonIndex !== -1) {
          clientKey = credentials.substring(0, colonIndex);
          clientSecret = credentials.substring(colonIndex + 1);
        }
      } catch (e) {
        logger.warn('[WOOCOMMERCE] Failed to parse Basic Authorization header:', e);
      }
    }

    // Check Query parameters fallback
    if (!clientKey && req.query.consumer_key) {
      clientKey = String(req.query.consumer_key);
    }
    if (!clientSecret && req.query.consumer_secret) {
      clientSecret = String(req.query.consumer_secret);
    }

    // Constant-time comparison
    const keyMatch = clientKey && clientKey.length === consumerKey.length &&
      crypto.timingSafeEqual(Buffer.from(clientKey), Buffer.from(consumerKey));
    const secretMatch = clientSecret && clientSecret.length === consumerSecret.length &&
      crypto.timingSafeEqual(Buffer.from(clientSecret), Buffer.from(consumerSecret));

    if (!keyMatch || !secretMatch) {
      logger.warn('[WOOCOMMERCE] Authentication failed. Invalid or missing credentials.');
      return res.status(401).json({
        code: 'woocommerce_rest_cannot_view',
        message: 'Sorry, you cannot list resources.',
        data: { status: 401 }
      });
    }

    next();
  }

  // Helper to compute a stable, positive 31-bit integer for WooCommerce order ID
  function getNumericIdForOrder(order) {
    if (typeof order.wcId === 'number') return order.wcId;
    let hash = 0;
    const str = String(order.orderId || '');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 2000000000 + 1000;
  }

  // Helper to resolve an order from either integer ID or UUID
  async function findOrderByIdOrUuid(idParam) {
    const allOrders = await db.getAllOrders();
    const idStr = String(idParam).trim();

    // 1. Direct UUID match
    let match = allOrders.find(o => o.orderId === idStr);
    if (match) return match;

    // 2. Numeric WC ID match
    const numId = parseInt(idStr, 10);
    if (!isNaN(numId)) {
      match = allOrders.find(o => getNumericIdForOrder(o) === numId || o.wcId === numId);
      if (match) return match;
    }

    // 3. Prefix UUID match
    match = allOrders.find(o => o.orderId.startsWith(idStr));
    return match || null;
  }

  // Helper to send shipping email notification
  async function sendShipmentNotification(order, trackingNumber, courier) {
    if (!order.billingContact?.email) return;

    try {
      const customerName = order.billingContact.givenName || 'Valued Customer';
      const shippingAddress = order.shippingContact || {};
      const addressLines = shippingAddress.addressLines || [];
      const orderDate = order.receivedAt
        ? new Date(order.receivedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'recently';

      const safeAddressLines = addressLines.map(line => escapeHtml(line)).join('<br>');
      const addressHtml = `
        <address>
            ${escapeHtml(shippingAddress.givenName || '')} ${escapeHtml(shippingAddress.familyName || '')}<br>
            ${safeAddressLines}<br>
            ${escapeHtml(shippingAddress.locality || '')}, ${escapeHtml(shippingAddress.administrativeDistrictLevel1 || '')} ${escapeHtml(shippingAddress.postalCode || '')}<br>
            ${escapeHtml(shippingAddress.country || '')}<br>
            ${escapeHtml(shippingAddress.phoneNumber || '')}
        </address>
      `;

      const productDetailsHtml = `
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">Stickers</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${order.orderDetails?.quantity || 0}</td>
        </tr>
      `;

      if (scheduleEmail) {
        await scheduleEmail('send-shipping-email', {
          to: order.billingContact.email,
          subject: `Your Splotch order #${order.orderId} has shipped!`,
          text: `Hey ${customerName},\n\nHeads up—your order has been sent out!\n\nOrdered: ${orderDate}\n\nHere’s the tracking number:\n${trackingNumber}\n${courier}\n\nHere’s what’s in your Shipment:\nProduct: Stickers, Quantity: ${order.orderDetails?.quantity || 0}\n\nShipping address:\n${shippingAddress.givenName || ''} ${shippingAddress.familyName || ''}\n${addressLines.join('\n')}\n${shippingAddress.locality || ''}, ${shippingAddress.administrativeDistrictLevel1 || ''} ${shippingAddress.postalCode || ''}\n${shippingAddress.country || ''}\n${shippingAddress.phoneNumber || ''}\n\nStay in touch!\nSplotch`,
          html: `
            <p>Hey ${customerName},</p>
            <p>Heads up—your order has been sent out!</p>
            <p><b>Ordered:</b> ${orderDate}</p>
            <p>Here’s the tracking number:</p>
            <p><b>${escapeHtml(trackingNumber)}</b><br>${escapeHtml(courier)}</p>
            <p><i>Tracking information can take up to 48 hours to be updated after the order is shipped.</i></p>
            <h3>Here’s what’s in your Shipment:</h3>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 10px; border-bottom: 2px solid #ddd;">Product</th>
                        <th style="text-align: left; padding: 10px; border-bottom: 2px solid #ddd;">Qty</th>
                    </tr>
                </thead>
                <tbody>
                    ${productDetailsHtml}
                </tbody>
            </table>
            <h3>Shipping address:</h3>
            ${addressHtml}
            <p>Stay in touch!</p>
            <p><b>Splotch</b></p>
          `,
        });
        logger.info(`[WOOCOMMERCE] Shipment notification email queued for order ID ${order.orderId}.`);
      }
    } catch (emailError) {
      logger.error(`[WOOCOMMERCE] Failed to queue shipment notification for order ${order.orderId}:`, emailError);
    }
  }

  // Helper to extract tracking number & carrier from text / notes
  function parseTrackingInfo(text) {
    if (!text || typeof text !== 'string') return null;

    let courier = 'USPS';
    if (/\b(UPS|United Parcel Service)\b/i.test(text)) courier = 'UPS';
    else if (/\b(FedEx|Federal Express)\b/i.test(text)) courier = 'FedEx';
    else if (/\bDHL\b/i.test(text)) courier = 'DHL';

    // 1. USPS Tracking patterns (20-22 digits starting with 9, or standard 2 letter + 9 digits + 2 letter format)
    const uspsMatch = text.match(/\b(9[12345]\d{18,21})\b/) || text.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/);
    if (uspsMatch) {
      return { trackingNumber: uspsMatch[1], courier: courier || 'USPS' };
    }

    // 2. UPS Tracking pattern (1Z + 16 chars)
    const upsMatch = text.match(/\b(1Z[0-9A-Z]{16})\b/i);
    if (upsMatch) {
      return { trackingNumber: upsMatch[1].toUpperCase(), courier: 'UPS' };
    }

    // 3. FedEx Tracking pattern (12, 15, or 20 digits)
    const fedexMatch = text.match(/\b(\d{12}|\d{15})\b/);
    if (fedexMatch && courier === 'FedEx') {
      return { trackingNumber: fedexMatch[1], courier: 'FedEx' };
    }

    // 4. Labeled tracking pattern e.g. "Tracking: ABC123456"
    const labelMatch = text.match(/(?:tracking(?:\s*number)?|tracking#|track(?:ing)?:?)[:\s]+([A-Za-z0-9]+)/i);
    if (labelMatch) {
      return { trackingNumber: labelMatch[1], courier };
    }

    return null;
  }

  // Helper: Format a Splotch order into WooCommerce REST API v3 order JSON
  function splotchToWooOrder(order, req) {
    const numericId = getNumericIdForOrder(order);
    const host = req ? req.get('host') : 'www.splotch.page';
    const protocol = req ? req.protocol : 'https';
    const baseUrl = `${protocol}://${host}`;

    const shipping = order.shippingContact || {};
    const billing = order.billingContact || {};
    const addressLines = shipping.addressLines || [];
    const address1 = addressLines[0] || '';
    const address2 = addressLines.slice(1).join(' ') || '';
    const billingAddressLines = billing.addressLines || addressLines;

    const receivedDate = order.receivedAt
      ? new Date(order.receivedAt).toISOString().replace(/\.\d{3}Z$/, '')
      : new Date().toISOString().replace(/\.\d{3}Z$/, '');
    const updatedDate = order.lastUpdatedAt
      ? new Date(order.lastUpdatedAt).toISOString().replace(/\.\d{3}Z$/, '')
      : receivedDate;

    const totalDollars = (order.amount ? (order.amount / 100).toFixed(2) : '0.00');

    // Status mapping
    let wcStatus = 'processing';
    if (['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(order.status)) {
      wcStatus = 'completed';
    } else if (order.status === 'CANCELED') {
      wcStatus = 'cancelled';
    } else if (['NEW', 'ACCEPTED', 'PRINTING'].includes(order.status)) {
      wcStatus = 'processing';
    }

    const quantity = order.orderDetails?.quantity || 1;
    const material = order.orderDetails?.material || 'Custom Stickers';
    const productName = `Custom Stickers (${quantity} pcs - ${material})`;

    const metaData = [
      { id: 1, key: '_splotch_order_id', value: order.orderId },
      { id: 2, key: '_splotch_status', value: order.status }
    ];
    if (order.trackingNumber) {
      metaData.push({ id: 3, key: '_tracking_number', value: order.trackingNumber });
    }
    if (order.courier) {
      metaData.push({ id: 4, key: '_tracking_company', value: order.courier });
    }

    return {
      id: numericId,
      parent_id: 0,
      number: String(numericId),
      order_key: `wc_order_${order.orderId}`,
      created_via: 'splotch-store',
      version: '8.5.0',
      status: wcStatus,
      currency: order.currency || 'USD',
      date_created: receivedDate,
      date_created_gmt: receivedDate,
      date_modified: updatedDate,
      date_modified_gmt: updatedDate,
      discount_total: '0.00',
      discount_tax: '0.00',
      shipping_total: '0.00',
      shipping_tax: '0.00',
      cart_tax: '0.00',
      total: totalDollars,
      total_tax: '0.00',
      prices_include_tax: false,
      customer_id: 0,
      customer_ip_address: '',
      customer_user_agent: '',
      customer_note: order.orderDetails?.instructions || '',
      billing: {
        first_name: billing.givenName || shipping.givenName || '',
        last_name: billing.familyName || shipping.familyName || '',
        company: '',
        address_1: billingAddressLines[0] || address1,
        address_2: billingAddressLines.slice(1).join(' ') || address2,
        city: billing.locality || shipping.locality || '',
        state: billing.administrativeDistrictLevel1 || shipping.administrativeDistrictLevel1 || '',
        postcode: billing.postalCode || shipping.postalCode || '',
        country: billing.country || shipping.country || 'US',
        email: billing.email || shipping.email || '',
        phone: billing.phoneNumber || shipping.phoneNumber || ''
      },
      shipping: {
        first_name: shipping.givenName || '',
        last_name: shipping.familyName || '',
        company: '',
        address_1: address1,
        address_2: address2,
        city: shipping.locality || '',
        state: shipping.administrativeDistrictLevel1 || '',
        postcode: shipping.postalCode || '',
        country: shipping.country || 'US',
        phone: shipping.phoneNumber || ''
      },
      payment_method: 'square',
      payment_method_title: 'Credit Card (Square)',
      transaction_id: order.paymentId || order.squareOrderId || '',
      date_paid: receivedDate,
      date_paid_gmt: receivedDate,
      date_completed: ['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(order.status) ? updatedDate : null,
      date_completed_gmt: ['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(order.status) ? updatedDate : null,
      cart_hash: '',
      meta_data: metaData,
      line_items: [
        {
          id: numericId * 10 + 1,
          name: productName,
          product_id: 100,
          variation_id: 0,
          quantity: 1,
          tax_class: '',
          subtotal: totalDollars,
          subtotal_tax: '0.00',
          total: totalDollars,
          total_tax: '0.00',
          taxes: [],
          meta_data: [
            { id: 10, key: 'Sticker Count', value: String(quantity) },
            { id: 11, key: 'Material', value: material },
            ...(order.designImagePath ? [{ id: 12, key: 'Design Image', value: `${baseUrl}${order.designImagePath}` }] : [])
          ],
          sku: `STK-${quantity}`,
          price: parseFloat(totalDollars) || 0,
          image: order.designImagePath ? {
            id: 1,
            src: `${baseUrl}${order.designImagePath}`
          } : null
        }
      ],
      tax_lines: [],
      shipping_lines: [
        {
          id: numericId * 10 + 2,
          method_title: 'Standard Shipping',
          method_id: 'flat_rate',
          total: '0.00',
          total_tax: '0.00',
          taxes: [],
          meta_data: []
        }
      ],
      fee_lines: [],
      coupon_lines: [],
      refunds: [],
      _links: {
        self: [{ href: `${baseUrl}/wp-json/wc/v3/orders/${numericId}` }],
        collection: [{ href: `${baseUrl}/wp-json/wc/v3/orders` }]
      }
    };
  }

  // Set standard WordPress REST API discovery headers on all /wp-json routes
  router.use('/wp-json', (req, res, next) => {
    const host = req.get('host') || 'www.splotch.page';
    const protocol = req.protocol === 'http' && req.secure ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.setHeader('Link', `<${baseUrl}/wp-json/>; rel="https://api.w.org/"`);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-WP-Nonce, Content-Disposition, Content-MD5, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'X-WP-Total, X-WP-TotalPages, Link');
    res.setHeader('Allow', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
  });

  // Detailed incoming logger for debugging external integrations
  router.use((req, res, next) => {
    const url = req.originalUrl || req.url;
    if (url && (url.includes('/wp-json') || url.includes('/wc-auth') || url.includes('xmlrpc'))) {
      logger.info(`[WOOCOMMERCE] Incoming ${req.method} ${url}`, {
        userAgent: req.headers['user-agent'] || 'none',
        auth: req.headers.authorization ? 'present' : 'none',
        query: req.query,
        ip: req.ip
      });
    }
    next();
  });

  // --- XML-RPC RSD DISCOVERY ---
  router.get('/xmlrpc.php', (req, res) => {
    const host = req.get('host') || 'www.splotch.page';
    const protocol = req.protocol === 'http' && req.secure ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rsd version="1.0" xmlns="http://archipelago.phrasewise.com/rsd">
  <service>
    <engineName>WordPress</engineName>
    <engineLink>https://wordpress.org/</engineLink>
    <homePageLink>${baseUrl}/</homePageLink>
    <apis>
      <api name="WordPress" blogID="1" preferred="true" apiLink="${baseUrl}/xmlrpc.php" />
      <api name="WP-API" blogID="1" preferred="false" apiLink="${baseUrl}/wp-json/" />
    </apis>
  </service>
</rsd>`);
  });

  // Helper to build dynamic schema for a given version
  function buildDynamicSchema(version, baseUrl) {
    const sourceSchema = (version === 'v3' && wcV3Schema) ? wcV3Schema : (wcV1Schema || null);
    if (!sourceSchema) {
      return {
        namespace: `wc/${version}`,
        routes: {
          [`/wc/${version}`]: { namespace: `wc/${version}`, methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }] },
          [`/wc/${version}/orders`]: { namespace: `wc/${version}`, methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }, { methods: ['POST'], args: {} }] },
          [`/wc/${version}/orders/(?P<id>[\\d]+)`]: { namespace: `wc/${version}`, methods: ['GET', 'PUT', 'DELETE'], endpoints: [{ methods: ['GET'], args: {} }] },
          [`/wc/${version}/orders/(?P<order_id>[\\d]+)/notes`]: { namespace: `wc/${version}`, methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }] },
          [`/wc/${version}/system_status`]: { namespace: `wc/${version}`, methods: ['GET'] }
        },
        _links: {
          up: [{ href: `${baseUrl}/wp-json/` }]
        }
      };
    }

    const schemaStr = JSON.stringify(sourceSchema);
    const customizedStr = schemaStr.replace(/https:\/\/woocommerce\.com/g, baseUrl);
    const parsed = JSON.parse(customizedStr);
    parsed.namespace = `wc/${version}`;
    if (!parsed._links) parsed._links = {};
    parsed._links.up = [{ href: `${baseUrl}/wp-json/` }];
    return parsed;
  }

  // --- DISCOVERY ENDPOINTS ---

  // GET /wp-json and /wp-json/
  router.get(['/wp-json', '/wp-json/'], (req, res) => {
    const host = req.get('host') || 'www.splotch.page';
    const protocol = req.protocol === 'http' && req.secure ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.json({
      name: 'Splotch',
      description: 'Splotch Custom Stickers Store',
      url: baseUrl,
      home: baseUrl,
      gmt_offset: 0,
      timezone_string: 'UTC',
      namespaces: [
        'wp/v2',
        'wc/v1',
        'wc/v2',
        'wc/v3',
        'wc-shipment-tracking/v3'
      ],
      authentication: [],
      routes: {
        '/': { namespace: '', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }], _links: { self: [{ href: `${baseUrl}/wp-json/` }] } },
        '/wp/v2': { namespace: 'wp/v2', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v1': { namespace: 'wc/v1', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }], _links: { self: [{ href: `${baseUrl}/wp-json/wc/v1` }] } },
        '/wc/v2': { namespace: 'wc/v2', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }], _links: { self: [{ href: `${baseUrl}/wp-json/wc/v2` }] } },
        '/wc/v3': { namespace: 'wc/v3', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }], _links: { self: [{ href: `${baseUrl}/wp-json/wc/v3` }] } },
        '/wc/v1/orders': { namespace: 'wc/v1', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }, { methods: ['POST'], args: {} }] },
        '/wc/v2/orders': { namespace: 'wc/v2', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }, { methods: ['POST'], args: {} }] },
        '/wc/v3/orders': { namespace: 'wc/v3', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }, { methods: ['POST'], args: {} }] },
        '/wc/v1/orders/(?P<id>[\\d]+)': { namespace: 'wc/v1', methods: ['GET', 'PUT', 'DELETE'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v2/orders/(?P<id>[\\d]+)': { namespace: 'wc/v2', methods: ['GET', 'PUT', 'DELETE'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v3/orders/(?P<id>[\\d]+)': { namespace: 'wc/v3', methods: ['GET', 'PUT', 'DELETE'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v1/orders/(?P<order_id>[\\d]+)/notes': { namespace: 'wc/v1', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v2/orders/(?P<order_id>[\\d]+)/notes': { namespace: 'wc/v2', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v3/orders/(?P<order_id>[\\d]+)/notes': { namespace: 'wc/v3', methods: ['GET', 'POST'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v1/system_status': { namespace: 'wc/v1', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v2/system_status': { namespace: 'wc/v2', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }] },
        '/wc/v3/system_status': { namespace: 'wc/v3', methods: ['GET'], endpoints: [{ methods: ['GET'], args: {} }] }
      },
      _links: {
        help: [{ href: 'https://developer.wordpress.org/rest-api/' }]
      }
    });
  });

  // GET /wp-json/wc/v1, /wp-json/wc/v2, /wp-json/wc/v3 (with optional trailing slashes)
  const handleWcIndex = (version) => (req, res) => {
    const host = req.get('host') || 'www.splotch.page';
    const protocol = req.protocol === 'http' && req.secure ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.json(buildDynamicSchema(version, baseUrl));
  };

  router.get(['/wp-json/wc/v3', '/wp-json/wc/v3/'], handleWcIndex('v3'));
  router.get(['/wp-json/wc/v2', '/wp-json/wc/v2/'], handleWcIndex('v2'));
  router.get(['/wp-json/wc/v1', '/wp-json/wc/v1/'], handleWcIndex('v1'));

  // GET /wp-json/wc/v3/settings, v2, v1
  router.get([
    '/wp-json/wc/v3/settings',
    '/wp-json/wc/v2/settings',
    '/wp-json/wc/v1/settings'
  ], authenticateWooCommerce, (req, res) => {
    res.json([
      { id: 'general', label: 'General', description: 'General settings' },
      { id: 'products', label: 'Products', description: 'Product settings' },
      { id: 'shipping', label: 'Shipping', description: 'Shipping settings' },
      { id: 'checkout', label: 'Checkout', description: 'Checkout settings' }
    ]);
  });

  // GET /wp-json/wc/v3/system_status, v2, v1
  router.get([
    '/wp-json/wc/v3/system_status',
    '/wp-json/wc/v2/system_status',
    '/wp-json/wc/v1/system_status'
  ], authenticateWooCommerce, (req, res) => {
    const host = req.get('host') || 'www.splotch.page';
    const protocol = req.protocol === 'http' && req.secure ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${host}`;

    res.json({
      environment: {
        home_url: baseUrl,
        site_url: baseUrl,
        version: '8.5.0',
        log_directory: '/tmp',
        log_directory_writable: true,
        wp_version: '6.4.3',
        wp_multisite: false,
        wp_memory_limit: 268435456,
        wp_debug_mode: false,
        wp_cron: true,
        language: 'en_US',
        server_info: 'Node.js Express',
        php_version: '8.2.0',
        php_post_max_size: 104857600,
        php_max_execution_time: 300,
        php_max_input_vars: 1000,
        curl_version: '7.88.1',
        suhosin_installed: false,
        max_upload_size: 104857600,
        mysql_version: '8.0.0',
        mysql_version_string: '8.0.0',
        default_timezone: 'UTC',
        fsockopen_or_curl_enabled: true,
        soapclient_enabled: true,
        domdocument_enabled: true,
        gzip_enabled: true,
        mbstring_enabled: true,
        remote_post_successful: true,
        remote_post_response: '200'
      },
      database: { wc_database_version: '8.5.0' },
      settings: {
        currency: 'USD',
        currency_symbol: '$',
        currency_position: 'left',
        thousand_separator: ',',
        decimal_separator: '.',
        number_of_decimals: 2,
        geolocation_enabled: false,
        taxonomies: {}
      },
      security: { secure_connection: true, hide_errors: true }
    });
  });

  // --- ORDERS ENDPOINTS ---

  // GET /wp-json/wc/v3/orders (and v2, v1)
  router.get([
    '/wp-json/wc/v3/orders',
    '/wp-json/wc/v2/orders',
    '/wp-json/wc/v1/orders'
  ], authenticateWooCommerce, async (req, res) => {
    try {
      const allOrders = await db.getAllOrders();

      // Status filtering
      let statusFilter = req.query.status || 'any';
      if (Array.isArray(statusFilter)) {
        statusFilter = statusFilter.join(',');
      }
      const requestedStatuses = String(statusFilter).split(',').map(s => s.trim().toLowerCase());

      let filteredOrders = allOrders;

      if (!requestedStatuses.includes('any')) {
        filteredOrders = allOrders.filter(order => {
          const s = (order.status || '').toUpperCase();
          if (requestedStatuses.includes('processing')) {
            if (['NEW', 'ACCEPTED', 'PRINTING'].includes(s)) return true;
          }
          if (requestedStatuses.includes('completed')) {
            if (['SHIPPED', 'COMPLETED', 'DELIVERED'].includes(s)) return true;
          }
          if (requestedStatuses.includes('cancelled') || requestedStatuses.includes('canceled')) {
            if (s === 'CANCELED') return true;
          }
          if (requestedStatuses.includes('pending')) {
            if (s === 'NEW') return true;
          }
          return false;
        });
      }

      // Date filtering (after, before)
      if (req.query.after) {
        const afterDate = new Date(req.query.after);
        if (!isNaN(afterDate.getTime())) {
          filteredOrders = filteredOrders.filter(o => new Date(o.receivedAt) >= afterDate);
        }
      }
      if (req.query.before) {
        const beforeDate = new Date(req.query.before);
        if (!isNaN(beforeDate.getTime())) {
          filteredOrders = filteredOrders.filter(o => new Date(o.receivedAt) <= beforeDate);
        }
      }

      // Ordering
      const orderDir = (req.query.order || 'desc').toLowerCase();
      filteredOrders.sort((a, b) => {
        const dateA = new Date(a.receivedAt || 0).getTime();
        const dateB = new Date(b.receivedAt || 0).getTime();
        return orderDir === 'asc' ? dateA - dateB : dateB - dateA;
      });

      // Pagination
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 10));
      const totalOrders = filteredOrders.length;
      const totalPages = Math.ceil(totalOrders / perPage) || 1;
      const startIndex = (page - 1) * perPage;
      const pageOrders = filteredOrders.slice(startIndex, startIndex + perPage);

      // Convert to WooCommerce format
      const formattedOrders = pageOrders.map(order => splotchToWooOrder(order, req));

      // Standard WordPress REST API headers
      res.setHeader('X-WP-Total', totalOrders);
      res.setHeader('X-WP-TotalPages', totalPages);

      logger.info(`[WOOCOMMERCE] Listed ${formattedOrders.length} orders (page ${page}/${totalPages}, status filter: ${statusFilter})`);
      res.json(formattedOrders);
    } catch (error) {
      logger.error('[WOOCOMMERCE] Error listing orders:', error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // GET /wp-json/wc/v3/orders/:id (and v2, v1)
  router.get([
    '/wp-json/wc/v3/orders/:id',
    '/wp-json/wc/v2/orders/:id',
    '/wp-json/wc/v1/orders/:id'
  ], authenticateWooCommerce, async (req, res) => {
    try {
      const order = await findOrderByIdOrUuid(req.params.id);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      res.json(splotchToWooOrder(order, req));
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error fetching order ${req.params.id}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // Common handler for updating an order (supports PUT and POST /orders/:id)
  async function handleOrderUpdate(req, res) {
    try {
      const order = await findOrderByIdOrUuid(req.params.id);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      const body = req.body || {};
      let updated = false;

      // 1. Status update
      if (body.status) {
        const incomingStatus = String(body.status).toLowerCase();
        if (incomingStatus === 'completed' || incomingStatus === 'shipped') {
          if (order.status !== 'SHIPPED' && order.status !== 'COMPLETED') {
            order.status = 'SHIPPED';
            updated = true;
          }
        } else if (incomingStatus === 'cancelled' || incomingStatus === 'canceled') {
          order.status = 'CANCELED';
          updated = true;
        } else if (incomingStatus === 'processing') {
          if (order.status === 'NEW') {
            order.status = 'ACCEPTED';
            updated = true;
          }
        }
      }

      // 2. Check meta_data for tracking information
      if (Array.isArray(body.meta_data)) {
        let metaTrackingNumber = '';
        let metaCourier = '';

        for (const meta of body.meta_data) {
          const key = (meta.key || '').toLowerCase();
          const val = meta.value;

          if (key === '_tracking_number' || key === 'tracking_number') {
            metaTrackingNumber = String(val);
          } else if (key === '_tracking_company' || key === 'tracking_provider' || key === 'courier') {
            metaCourier = String(val);
          } else if (key === '_wc_shipment_tracking_items' && Array.isArray(val) && val[0]) {
            metaTrackingNumber = val[0].tracking_number || metaTrackingNumber;
            metaCourier = val[0].tracking_provider || val[0].custom_tracking_provider || metaCourier;
          }
        }

        if (metaTrackingNumber && metaTrackingNumber !== order.trackingNumber) {
          order.trackingNumber = metaTrackingNumber;
          order.courier = metaCourier || 'USPS';
          order.status = 'SHIPPED';
          updated = true;
          await sendShipmentNotification(order, order.trackingNumber, order.courier);
        }
      }

      if (updated) {
        order.lastUpdatedAt = new Date().toISOString();
        await db.updateOrder(order);
        logger.info(`[WOOCOMMERCE] Updated order ${order.orderId} status to ${order.status}.`);

        if (scheduleTelegram && order.telegramMessageId) {
          try {
            await scheduleTelegram('update-status', { orderId: order.orderId, status: order.status });
          } catch (tErr) {
            logger.error('[WOOCOMMERCE] Failed to queue Telegram update:', tErr);
          }
        }
      }

      res.json(splotchToWooOrder(order, req));
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error updating order ${req.params.id}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  }

  router.put([
    '/wp-json/wc/v3/orders/:id',
    '/wp-json/wc/v2/orders/:id',
    '/wp-json/wc/v1/orders/:id'
  ], authenticateWooCommerce, handleOrderUpdate);

  router.post([
    '/wp-json/wc/v3/orders/:id',
    '/wp-json/wc/v2/orders/:id',
    '/wp-json/wc/v1/orders/:id'
  ], authenticateWooCommerce, handleOrderUpdate);

  // --- ORDER NOTES ENDPOINTS ---

  // POST /wp-json/wc/v3/orders/:id/notes (and v2, v1, :order_id)
  // Pirate Ship commonly posts tracking info as an order note when a shipping label is created!
  router.post([
    '/wp-json/wc/v3/orders/:id/notes',
    '/wp-json/wc/v2/orders/:id/notes',
    '/wp-json/wc/v1/orders/:id/notes',
    '/wp-json/wc/v3/orders/:order_id/notes',
    '/wp-json/wc/v2/orders/:order_id/notes',
    '/wp-json/wc/v1/orders/:order_id/notes'
  ], authenticateWooCommerce, async (req, res) => {
    const orderIdParam = req.params.order_id || req.params.id;
    try {
      const order = await findOrderByIdOrUuid(orderIdParam);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      const noteText = req.body?.note || '';
      logger.info(`[WOOCOMMERCE] Received note on order ${order.orderId}: "${noteText}"`);

      // Store note in order history
      if (!order.notes) order.notes = [];
      const noteEntry = {
        id: Date.now(),
        date_created: new Date().toISOString(),
        note: noteText,
        customer_note: req.body?.customer_note !== false,
        added_by: 'Pirate Ship'
      };
      order.notes.push(noteEntry);

      // Parse tracking number and courier from note
      const tracking = parseTrackingInfo(noteText);
      if (tracking && tracking.trackingNumber) {
        const isNewTracking = order.trackingNumber !== tracking.trackingNumber;
        order.trackingNumber = tracking.trackingNumber;
        order.courier = tracking.courier || 'USPS';
        order.status = 'SHIPPED';
        order.lastUpdatedAt = new Date().toISOString();

        await db.updateOrder(order);
        logger.info(`[WOOCOMMERCE] Extracted tracking ${tracking.trackingNumber} (${tracking.courier}) for order ${order.orderId}`);

        if (isNewTracking) {
          await sendShipmentNotification(order, tracking.trackingNumber, tracking.courier);
          if (scheduleTelegram && order.telegramMessageId) {
            try {
              await scheduleTelegram('update-status', { orderId: order.orderId, status: order.status });
            } catch (tErr) {
              logger.error('[WOOCOMMERCE] Failed to queue Telegram update from note:', tErr);
            }
          }
        }
      } else {
        await db.updateOrder(order);
      }

      res.status(201).json({
        id: noteEntry.id,
        author: 'Pirate Ship',
        date_created: noteEntry.date_created,
        date_created_gmt: noteEntry.date_created,
        note: noteText,
        customer_note: noteEntry.customer_note,
        added_by_user: false
      });
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error creating order note on order ${orderIdParam}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // GET /wp-json/wc/v3/orders/:id/notes (and v2, v1, :order_id)
  router.get([
    '/wp-json/wc/v3/orders/:id/notes',
    '/wp-json/wc/v2/orders/:id/notes',
    '/wp-json/wc/v1/orders/:id/notes',
    '/wp-json/wc/v3/orders/:order_id/notes',
    '/wp-json/wc/v2/orders/:order_id/notes',
    '/wp-json/wc/v1/orders/:order_id/notes'
  ], authenticateWooCommerce, async (req, res) => {
    const orderIdParam = req.params.order_id || req.params.id;
    try {
      const order = await findOrderByIdOrUuid(orderIdParam);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      const notes = (order.notes || []).map(n => ({
        id: n.id || 1,
        author: n.added_by || 'System',
        date_created: n.date_created || order.receivedAt,
        date_created_gmt: n.date_created || order.receivedAt,
        note: n.note,
        customer_note: n.customer_note ?? true,
        added_by_user: false
      }));

      res.json(notes);
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error fetching notes for order ${orderIdParam}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // --- WOOCOMMERCE SHIPMENT TRACKING EXTENSION ENDPOINTS ---

  // POST /wp-json/wc-shipment-tracking/v3/orders/:id/shipment-trackings
  router.post('/wp-json/wc-shipment-tracking/v3/orders/:id/shipment-trackings', authenticateWooCommerce, async (req, res) => {
    try {
      const order = await findOrderByIdOrUuid(req.params.id);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      const trackingNumber = req.body?.tracking_number;
      const courier = req.body?.tracking_provider || req.body?.custom_tracking_provider || 'USPS';

      if (!trackingNumber) {
        return res.status(400).json({ code: 'missing_tracking_number', message: 'Tracking number is required.' });
      }

      order.trackingNumber = trackingNumber;
      order.courier = courier;
      order.status = 'SHIPPED';
      order.lastUpdatedAt = new Date().toISOString();

      await db.updateOrder(order);
      await sendShipmentNotification(order, trackingNumber, courier);

      if (scheduleTelegram && order.telegramMessageId) {
        try {
          await scheduleTelegram('update-status', { orderId: order.orderId, status: order.status });
        } catch (tErr) {
          logger.error('[WOOCOMMERCE] Failed to queue Telegram update from shipment tracking:', tErr);
        }
      }

      res.status(201).json({
        tracking_id: '1',
        tracking_provider: courier,
        tracking_number: trackingNumber,
        date_shipped: req.body?.date_shipped || new Date().toISOString().split('T')[0]
      });
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error adding shipment tracking for order ${req.params.id}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // GET /wp-json/wc-shipment-tracking/v3/orders/:id/shipment-trackings
  router.get('/wp-json/wc-shipment-tracking/v3/orders/:id/shipment-trackings', authenticateWooCommerce, async (req, res) => {
    try {
      const order = await findOrderByIdOrUuid(req.params.id);
      if (!order) {
        return res.status(404).json({
          code: 'woocommerce_rest_shop_order_invalid_id',
          message: 'Invalid ID.',
          data: { status: 404 }
        });
      }

      if (!order.trackingNumber) {
        return res.json([]);
      }

      res.json([
        {
          tracking_id: '1',
          tracking_provider: order.courier || 'USPS',
          tracking_number: order.trackingNumber,
          date_shipped: order.lastUpdatedAt ? order.lastUpdatedAt.split('T')[0] : new Date().toISOString().split('T')[0]
        }
      ]);
    } catch (error) {
      logger.error(`[WOOCOMMERCE] Error listing shipment trackings for order ${req.params.id}:`, error);
      res.status(500).json({ code: 'woocommerce_rest_error', message: error.message });
    }
  });

  // --- WOOCOMMERCE OAUTH AUTHORIZATION FLOW ---

  // --- WOOCOMMERCE OAUTH AUTHORIZATION FLOW ---

  // GET /wc-auth/v1/authorize
  router.get('/wc-auth/v1/authorize', async (req, res) => {
    const { app_name, return_url, callback_url, user_id, scope } = req.query;

    const safeAppName = escapeHtml(app_name || 'Pirate Ship');
    const safeScope = escapeHtml(scope || 'read_write');
    const callbackHost = callback_url ? escapeHtml(new URL(callback_url).host) : 'pirateship.com';

    const grantParams = new URLSearchParams({
      return_url: return_url || '',
      callback_url: callback_url || '',
      user_id: user_id || '',
      app_name: app_name || '',
      scope: scope || 'read_write'
    }).toString();

    const grantUrl = `/wc-auth/v1/grant?${grantParams}`;

    let denyUrl = return_url || '';
    if (denyUrl) {
      const sep = denyUrl.includes('?') ? '&' : '?';
      denyUrl = `${denyUrl}${sep}success=0&user_id=${encodeURIComponent(user_id || '')}`;
    } else {
      denyUrl = '#';
    }

    // Set permissive frame and CSP headers for OAuth popup / iframe
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' https:; frame-ancestors *");

    // Render authentic WooCommerce authorization view without any inline event scripts
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect ${safeAppName} to Splotch</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: white; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05); max-width: 460px; width: 100%; padding: 36px; text-align: center; border: 1px solid #e2e8f0; }
    .logo-container { margin-bottom: 20px; }
    .logo { width: 68px; height: 68px; border-radius: 50%; background: linear-gradient(135deg, #9333ea, #7e22ce); display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 32px; font-weight: 800; box-shadow: 0 4px 12px rgba(147, 51, 234, 0.3); }
    h1 { font-size: 22px; color: #0f172a; margin: 0 0 14px; font-weight: 700; line-height: 1.3; }
    p { font-size: 14px; color: #475569; line-height: 1.6; margin: 0 0 20px; text-align: left; }
    .permissions-list { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px 14px 34px; margin: 0 0 24px; text-align: left; font-size: 13px; color: #334155; }
    .permissions-list li { margin-bottom: 6px; }
    .permissions-list li:last-child { margin-bottom: 0; }
    .actions { display: flex; flex-direction: column; gap: 10px; }
    .btn { display: block; width: 100%; padding: 13px; border-radius: 8px; font-size: 15px; font-weight: 600; text-decoration: none; text-align: center; box-sizing: border-box; transition: all 0.15s ease-in-out; }
    .btn-primary { background: #9333ea; color: white; border: 1px solid #7e22ce; }
    .btn-primary:hover { background: #7e22ce; }
    .btn-secondary { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
    .btn-secondary:hover { background: #e2e8f0; color: #1e293b; }
    .footer-note { font-size: 12px; color: #94a3b8; margin-top: 18px; line-height: 1.4; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <div class="logo">S</div>
    </div>
    <h1>${safeAppName} would like to connect to your store</h1>
    <p>This will grant <strong>${safeAppName}</strong> <strong>${safeScope}</strong> access to Splotch to:</p>
    <ul class="permissions-list">
      <li>View orders ready for shipment (processing status)</li>
      <li>Create order shipping notes and synchronize tracking numbers</li>
    </ul>
    <p>Approving will securely share API keys with <strong>${callbackHost}</strong>.</p>
    <div class="actions">
      <a href="${grantUrl}" class="btn btn-primary" id="approve-btn">Approve Connection</a>
      <a href="${denyUrl}" class="btn btn-secondary" id="deny-btn">Deny</a>
    </div>
    <div class="footer-note">Splotch Store API • WooCommerce Parity v3</div>
  </div>
</body>
</html>`);
  });

  // Helper function to dispatch callback credentials and redirect
  async function completeOAuthHandshake(req, res, params) {
    const return_url = params.return_url;
    const callback_url = params.callback_url;
    const user_id = params.user_id;
    const scope = params.scope || 'read_write';
    const { consumerKey, consumerSecret } = getCredentials();

    logger.info(`[WOOCOMMERCE] Completing OAuth connection for user_id=${user_id}`);

    // If callback_url is provided, post the credentials directly to the integration client
    if (callback_url) {
      try {
        const payload = {
          key_id: 1,
          user_id: user_id || 1,
          consumer_key: consumerKey,
          consumer_secret: consumerSecret,
          key_permissions: scope
        };

        const callbackRes = await fetch(callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'User-Agent': 'WordPress/6.5.2; https://www.splotch.page'
          },
          body: JSON.stringify(payload)
        });

        const callbackBody = await callbackRes.text();
        logger.info(`[WOOCOMMERCE] Posted credentials to callback_url (${callback_url}): status ${callbackRes.status}, body: ${callbackBody}`);
      } catch (err) {
        logger.error('[WOOCOMMERCE] Error posting credentials to callback_url:', err);
      }
    }

    if (return_url) {
      const separator = return_url.includes('?') ? '&' : '?';
      return res.redirect(302, `${return_url}${separator}success=1&user_id=${encodeURIComponent(user_id || '')}`);
    }

    res.send('<h3>Connection Approved</h3><p>You can now return to Pirate Ship.</p>');
  }

  // GET /wc-auth/v1/grant - standard WooCommerce GET link redirect
  router.get('/wc-auth/v1/grant', async (req, res) => {
    await completeOAuthHandshake(req, res, req.query || {});
  });

  // POST /wc-auth/v1/authorize - form submission fallback
  router.post('/wc-auth/v1/authorize', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    await completeOAuthHandshake(req, res, params);
  });

  return {
    router,
    getCredentials,
    parseTrackingInfo,
    splotchToWooOrder
  };
}
