import express from 'express';
import Stripe from 'stripe';
import pool from '../utils/db.mjs';
import { geocodeAddress } from '../utils/geocode.mjs';

const router = express.Router();

/**
 * Use client-supplied lat/lng (e.g. from Leaflet pin) when valid; otherwise geocode.
 */
async function resolveAddressCoords(addressPayload) {
  const lat = addressPayload?.latitude;
  const lng = addressPayload?.longitude;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng))
  ) {
    return { latitude: Number(lat), longitude: Number(lng) };
  }
  return geocodeAddress({
    address_line: addressPayload.address_line,
    city: addressPayload.city ?? undefined,
    province: addressPayload.province ?? undefined,
    postal_code: addressPayload.postal_code ?? undefined,
  });
}

/**
 * Same user + same address_line/city/province/postal_code → reuse row, no duplicate INSERT.
 */
async function findOrInsertAddress(userId, addressPayload) {
  const line = String(addressPayload.address_line || '').trim();
  if (!line) return null;

  const coords = await resolveAddressCoords(addressPayload);
  const lat = coords?.latitude ?? null;
  const lng = coords?.longitude ?? null;

  const city = addressPayload.city != null ? String(addressPayload.city).trim() : '';
  const province = addressPayload.province != null ? String(addressPayload.province).trim() : '';
  const postal = addressPayload.postal_code != null ? String(addressPayload.postal_code).trim() : '';

  const existing = await pool.query(
    `SELECT id, latitude, longitude FROM addresses
     WHERE user_id = $1
       AND trim(address_line) = $2
       AND trim(coalesce(city, '')) = $3
       AND trim(coalesce(province, '')) = $4
       AND trim(coalesce(postal_code, '')) = $5
     LIMIT 1`,
    [userId, line, city, province, postal]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (
      lat != null &&
      lng != null &&
      (row.latitude == null ||
        row.longitude == null ||
        Number(row.latitude) !== lat ||
        Number(row.longitude) !== lng)
    ) {
      await pool.query(
        `UPDATE addresses SET latitude = $1, longitude = $2 WHERE id = $3`,
        [lat, lng, row.id]
      );
    }
    return row.id;
  }

  const ins = await pool.query(
    `INSERT INTO addresses (user_id, address_line, city, province, postal_code, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      userId,
      addressPayload.address_line,
      addressPayload.city ?? null,
      addressPayload.province ?? null,
      addressPayload.postal_code ?? null,
      lat,
      lng,
    ]
  );
  return ins.rows[0].id;
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

/**
 * GET /api/payment/config
 * Return publishable key for client-side Stripe.js.
 */
/**
 * GET /api/payment/addresses?authUserId=uuid
 * List saved addresses for the user (for dropdown). Same user + same address deduped by findOrInsertAddress on checkout.
 */
router.get('/addresses', async (req, res) => {
  try {
    const authUserId = typeof req.query.authUserId === 'string' ? req.query.authUserId.trim() : '';
    if (!authUserId) {
      return res.status(400).json({ error: 'authUserId is required.' });
    }
    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;
    const result = await pool.query(
      `SELECT id, address_line, city, province, postal_code, latitude, longitude, created_at
       FROM addresses
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.status(200).json({ addresses: result.rows });
  } catch (err) {
    console.error('List addresses error:', err);
    res.status(500).json({ error: 'Failed to list addresses.' });
  }
});

/**
 * POST /api/payment/addresses/coords
 * Update latitude/longitude on an existing address row only (no INSERT).
 * Body: { authUserId, addressId?, address_line, city?, province?, postal_code?, latitude, longitude }
 * - If addressId is set: UPDATE that row when it belongs to the user.
 * - Else: find row by same normalized fields as findOrInsertAddress; UPDATE if found (404 if no row).
 */
router.post('/addresses/coords', express.json(), async (req, res) => {
  try {
    const authUserId = typeof req.body?.authUserId === 'string' ? req.body.authUserId.trim() : '';
    if (!authUserId) {
      return res.status(400).json({ error: 'authUserId is required.' });
    }
    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    const lat = Number(req.body?.latitude);
    const lng = Number(req.body?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'latitude and longitude are required.' });
    }

    const addressId = req.body?.addressId != null ? Number(req.body.addressId) : null;
    if (addressId != null && Number.isFinite(addressId)) {
      const upd = await pool.query(
        `UPDATE addresses SET latitude = $1, longitude = $2
         WHERE id = $3 AND user_id = $4
         RETURNING id`,
        [lat, lng, addressId, userId]
      );
      if (upd.rows.length === 0) {
        return res.status(404).json({ error: 'Address not found or not owned by user.' });
      }
      return res.status(200).json({ ok: true, addressId: upd.rows[0].id });
    }

    const line = String(req.body?.address_line || '').trim();
    if (!line) {
      return res.status(400).json({ error: 'address_line is required when addressId is omitted.' });
    }
    const city = req.body?.city != null ? String(req.body.city).trim() : '';
    const province = req.body?.province != null ? String(req.body.province).trim() : '';
    const postal = req.body?.postal_code != null ? String(req.body.postal_code).trim() : '';

    const existing = await pool.query(
      `SELECT id FROM addresses
       WHERE user_id = $1
         AND trim(address_line) = $2
         AND trim(coalesce(city, '')) = $3
         AND trim(coalesce(province, '')) = $4
         AND trim(coalesce(postal_code, '')) = $5
       LIMIT 1`,
      [userId, line, city, province, postal]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({
        error: 'No matching saved address; checkout once to create the row, or use addressId.',
      });
    }
    const id = existing.rows[0].id;
    await pool.query(
      `UPDATE addresses SET latitude = $1, longitude = $2 WHERE id = $3`,
      [lat, lng, id]
    );
    res.status(200).json({ ok: true, addressId: id });
  } catch (err) {
    console.error('Update address coords error:', err);
    res.status(500).json({ error: 'Failed to update coordinates.' });
  }
});

router.get('/config', (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return res.status(500).json({ error: 'Stripe publishable key not configured.' });
  }
  res.status(200).json({ publishableKey });
});

/**
 * GET /api/payment/promotion/validate?code=XXXX
 * Validate promotion code against promotions table.
 * type: 'percentage' | 'fixed'
 * - percentage: discount_value is percent (e.g. 10 = 10% off). Discount = total * discount_value / 100
 * - fixed: discount_value is fixed amount in THB (e.g. 1000 = 1000 off). Discount = discount_value (capped by total)
 * Returns: { valid, promotionId?, discountType?, discountValue?, message? }
 */
router.get('/promotion/validate', async (req, res) => {
  try {
    const rawCode = req.query.code;
    if (typeof rawCode !== 'string') {
      return res.status(400).json({ error: 'Missing promotion code.' });
    }

    const code = rawCode.trim().toUpperCase();
    if (!code) {
      return res.status(400).json({ error: 'Missing promotion code.' });
    }

    const result = await pool.query(
      `SELECT id,
              code,
              discount_value,
              expiry_date,
              active,
              type,
              usage_limit,
              used_count
       FROM promotions
       WHERE UPPER(code) = $1
         AND active IS TRUE
         AND (expiry_date IS NULL OR expiry_date > now())
         AND (usage_limit IS NULL OR used_count < usage_limit)
       LIMIT 1`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        valid: false,
        message: 'โค้ดส่วนลดไม่ถูกต้องหรือหมดอายุแล้ว',
      });
    }

    const promo = result.rows[0];
    const discountType = promo.type === 'fixed' ? 'fixed' : 'percentage';
    const discountValue = Number(promo.discount_value) ?? 0;

    return res.status(200).json({
      valid: true,
      promotionId: promo.id,
      discountType,
      discountValue,
    });
  } catch (err) {
    console.error('Validate promotion code error:', err);
    res.status(500).json({ error: 'ไม่สามารถตรวจสอบโค้ดส่วนลดได้' });
  }
});

/**
 * POST /api/payment/create-checkout-session
 * Creates a pending order, Stripe Checkout Session, and returns the session URL.
 * Body: {
 *   authUserId: string (Supabase auth user UUID),
 *   addressId?: number (optional if address is provided),
 *   address?: { address_line, city?, province?, postal_code? } (optional, used to create address if addressId not set),
 *   promotionId?: number,
 *   items: [{ serviceId, name, quantity, price }],
 *   discountAmount: number,
 *   successUrl: string,
 *   cancelUrl: string,
 *   paymentType: 'CR' | 'QR' // CR = credit card, QR = PromptPay
 * }
 */
router.post('/create-checkout-session', express.json(), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  try {
    const {
      authUserId,
      addressId: providedAddressId,
      address: addressPayload,
      promotionId,
      items,
      discountAmount = 0,
      successUrl,
      cancelUrl,
      paymentType = 'CR',
      appointmentDate,
      appointmentTime,
      remark,
    } = req.body;

    if (!authUserId || !Array.isArray(items) || items.length === 0 || !successUrl || !cancelUrl) {
      return res.status(400).json({
        error: 'Missing required fields: authUserId, items, successUrl, cancelUrl',
      });
    }

    // Resolve internal user id from Supabase auth user id
    const userRes = await pool.query(
      'SELECT id FROM users WHERE auth_user_id = $1',
      [authUserId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    let addressId = providedAddressId;
    if (!addressId && addressPayload?.address_line) {
      addressId = await findOrInsertAddress(userId, addressPayload);
    }
    if (!addressId) {
      return res.status(400).json({
        error: 'Either addressId or address (with address_line) is required.',
      });
    }

    const totalPrice = items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
    const netPrice = Math.max(0, totalPrice - Number(discountAmount));

    // Create order in DB (pending)
    const orderRes = await pool.query(
      `INSERT INTO orders (
        user_id,
        address_id,
        promotion_id,
        status,
        payment_type,
        total_price,
        discount_amount,
        net_price,
        appointment_date,
        appointment_time,
        remark
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        userId,
        addressId,
        promotionId ?? null,
        paymentType,
        totalPrice,
        discountAmount,
        netPrice,
        appointmentDate || null,
        appointmentTime || null,
        remark || null,
      ]
    );
    const orderId = orderRes.rows[0].id;

    // Insert order_items
    for (const it of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, service_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.serviceId, it.quantity, it.price]
      );
    }

    // Stripe amounts in THB are in satang (1 THB = 100 satang). Stripe does not allow negative line amounts.
    const lineItems =
      discountAmount > 0
        ? [
            {
              price_data: {
                currency: 'thb',
                product_data: {
                  name: 'รายการบริการ (หลังหักส่วนลด)',
                },
                unit_amount: Math.round(netPrice * 100),
              },
              quantity: 1,
            },
          ]
        : items.map((it) => ({
            price_data: {
              currency: 'thb',
              product_data: {
                name: it.name || `Service #${it.serviceId}`,
              },
              unit_amount: Math.round(Number(it.price) * 100),
            },
            quantity: it.quantity,
          }));

    const paymentMethodTypes =
      paymentType === 'QR' ? ['promptpay'] : ['card'];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethodTypes,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { orderId: String(orderId) },
      client_reference_id: String(orderId),
    });

    // Store Stripe session_id on order
    await pool.query(
      'UPDATE orders SET session_id = $1, updated_at = now() WHERE id = $2',
      [session.id, orderId]
    );

    res.status(200).json({
      url: session.url,
      sessionId: session.id,
      orderId,
    });
  } catch (err) {
    console.error('Create checkout session error:', err);
    res.status(500).json({
      error: err.message || 'Failed to create checkout session.',
    });
  }
});

/**
 * POST /api/payment/create-payment-intent
 * Creates a pending order and a Stripe PaymentIntent for use with Stripe Elements.
 * Body: {
 *   authUserId: string (Supabase auth user UUID),
 *   addressId?: number,
 *   address?: { address_line, city?, province?, postal_code? },
 *   promotionId?: number,
 *   items: [{ serviceId, name, quantity, price }],
 *   discountAmount: number
 * }
 * Returns: { clientSecret, orderId }
 */
router.post('/create-payment-intent', express.json(), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  try {
    const {
      authUserId,
      addressId: providedAddressId,
      address: addressPayload,
      promotionId,
      items,
      discountAmount = 0,
      appointmentDate,
      appointmentTime,
      remark,
    } = req.body;

    if (!authUserId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: authUserId, items',
      });
    }

    // Resolve internal user id from Supabase auth user id
    const userRes = await pool.query(
      'SELECT id FROM users WHERE auth_user_id = $1',
      [authUserId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    let addressId = providedAddressId;
    if (!addressId && addressPayload?.address_line) {
      addressId = await findOrInsertAddress(userId, addressPayload);
    }
    if (!addressId) {
      return res.status(400).json({
        error: 'Either addressId or address (with address_line) is required.',
      });
    }

    const totalPrice = items.reduce(
      (sum, it) => sum + Number(it.price) * Number(it.quantity),
      0
    );
    const netPrice = Math.max(0, totalPrice - Number(discountAmount));

    // Create order in DB (pending), payment_type fixed to 'CR' for card
    const orderRes = await pool.query(
      `INSERT INTO orders (
        user_id,
        address_id,
        promotion_id,
        status,
        payment_type,
        total_price,
        discount_amount,
        net_price,
        appointment_date,
        appointment_time,
        remark
      ) VALUES ($1, $2, $3, 'pending', 'CR', $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        userId,
        addressId,
        promotionId ?? null,
        totalPrice,
        discountAmount,
        netPrice,
        appointmentDate || null,
        appointmentTime || null,
        remark || null,
      ]
    );
    const orderId = orderRes.rows[0].id;

    // Insert order_items
    for (const it of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, service_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.serviceId, it.quantity, it.price]
      );
    }

    // Create PaymentIntent for full netPrice
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(netPrice * 100),
      currency: 'thb',
      payment_method_types: ['card'],
      metadata: { orderId: String(orderId) },
    });

    // Store Stripe payment_intent id into session_id column for traceability
    await pool.query(
      'UPDATE orders SET session_id = $1, updated_at = now() WHERE id = $2',
      [paymentIntent.id, orderId]
    );

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      orderId,
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({
      error: err.message || 'Failed to create payment intent.',
    });
  }
});

/**
 * POST /api/payment/create-promptpay-intent
 * Creates a pending order and a Stripe PaymentIntent for PromptPay (QR).
 * Same body as create-payment-intent. Returns { clientSecret, orderId }.
 * Frontend uses Stripe.js confirmPromptPayPayment to display the QR (no redirect).
 */
router.post('/create-promptpay-intent', express.json(), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  try {
    const {
      authUserId,
      addressId: providedAddressId,
      address: addressPayload,
      promotionId,
      items,
      discountAmount = 0,
      appointmentDate,
      appointmentTime,
      remark,
    } = req.body;

    if (!authUserId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: authUserId, items',
      });
    }

    const userRes = await pool.query(
      'SELECT id FROM users WHERE auth_user_id = $1',
      [authUserId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    let addressId = providedAddressId;
    if (!addressId && addressPayload?.address_line) {
      addressId = await findOrInsertAddress(userId, addressPayload);
    }
    if (!addressId) {
      return res.status(400).json({
        error: 'Either addressId or address (with address_line) is required.',
      });
    }

    const totalPrice = items.reduce(
      (sum, it) => sum + Number(it.price) * Number(it.quantity),
      0
    );
    const netPrice = Math.max(0, totalPrice - Number(discountAmount));

    const orderRes = await pool.query(
      `INSERT INTO orders (
        user_id,
        address_id,
        promotion_id,
        status,
        payment_type,
        total_price,
        discount_amount,
        net_price,
        appointment_date,
        appointment_time,
        remark
      ) VALUES ($1, $2, $3, 'pending', 'QR', $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        userId,
        addressId,
        promotionId ?? null,
        totalPrice,
        discountAmount,
        netPrice,
        appointmentDate || null,
        appointmentTime || null,
        remark || null,
      ]
    );
    const orderId = orderRes.rows[0].id;

    for (const it of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, service_id, quantity, price)
         VALUES ($1, $2, $3, $4)`,
        [orderId, it.serviceId, it.quantity, it.price]
      );
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(netPrice * 100),
      currency: 'thb',
      payment_method_types: ['promptpay'],
      metadata: { orderId: String(orderId) },
    });

    await pool.query(
      'UPDATE orders SET session_id = $1, updated_at = now() WHERE id = $2',
      [paymentIntent.id, orderId]
    );

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      orderId,
    });
  } catch (err) {
    console.error('Create promptpay intent error:', err);
    res.status(500).json({
      error: err.message || 'Failed to create PromptPay intent.',
    });
  }
});

/**
 * GET /api/payment/session/:sessionId
 * Returns session status and order info for the success page.
 */
router.get('/session/:sessionId', async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  try {
    const { sessionId } = req.params;
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items'],
    });

    if (!session.metadata?.orderId) {
      return res.status(404).json({ error: 'Order not found for this session.' });
    }

    const orderId = session.metadata.orderId;

    // If payment is completed but webhook hasn't updated yet, ensure status is set to completed here as a fallback.
    if (session.payment_status === 'paid') {
      try {
        await pool.query(
          `UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1`,
          [orderId]
        );
        await incrementPromotionUsageForOrder(orderId);
      } catch (e) {
        console.error('Failed to update order status in session endpoint:', e);
      }
    }

    const orderRes = await pool.query(
      `SELECT o.id, o.status, o.net_price, o.total_price, o.discount_amount, o.created_at
       FROM orders o WHERE o.id = $1`,
      [orderId]
    );
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const order = orderRes.rows[0];
    const itemsRes = await pool.query(
      `SELECT oi.service_id, oi.quantity, oi.price, s.name
       FROM order_items oi
       JOIN services s ON s.id = oi.service_id
       WHERE oi.order_id = $1`,
      [orderId]
    );

    res.status(200).json({
      sessionId: session.id,
      paymentStatus: session.payment_status,
      order: {
        id: order.id,
        status: order.status,
        netPrice: Number(order.net_price),
        totalPrice: Number(order.total_price),
        discountAmount: Number(order.discount_amount),
        createdAt: order.created_at,
        items: itemsRes.rows.map((r) => ({
          serviceId: r.service_id,
          name: r.name,
          quantity: r.quantity,
          price: Number(r.price),
        })),
      },
    });
  } catch (err) {
    console.error('Get session error:', err);
    res.status(500).json({ error: err.message || 'Failed to get session.' });
  }
});

// Increment promotion usage based on orders.promotion_id when an order is successfully paid
async function incrementPromotionUsageForOrder(orderId) {
  try {
    const orderRes = await pool.query(
      `SELECT promotion_id
       FROM orders
       WHERE id = $1`,
      [orderId]
    );
    if (!orderRes.rows.length || !orderRes.rows[0].promotion_id) return;

    await pool.query(
      `UPDATE promotions
       SET used_count = (
         SELECT COUNT(*)
         FROM orders
         WHERE promotion_id = $1
           AND status = 'completed'
       )
       WHERE id = $1`,
      [orderRes.rows[0].promotion_id]
    );
  } catch (err) {
    console.error('Failed to increment promotion usage:', err);
  }
}

/**
 * Stripe webhook handler (must be mounted with express.raw() in app.mjs).
 * Verifies signature and on checkout.session.completed updates order status to 'completed'.
 */
export async function stripeWebhookHandler(req, res) {
  if (!stripe) {
    return res.status(503).send('Stripe not configured');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !sig) {
    return res.status(400).send('Missing webhook secret or signature');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.orderId;
    if (orderId) {
      try {
        await pool.query(
          `UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1`,
          [orderId]
        );
        await incrementPromotionUsageForOrder(orderId);
      } catch (err) {
        console.error('Failed to update order status after payment (checkout):', err);
      }
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const orderId = paymentIntent.metadata?.orderId;
    if (orderId) {
      try {
        await pool.query(
          `UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1`,
          [orderId]
        );
        await incrementPromotionUsageForOrder(orderId);
      } catch (err) {
        console.error('Failed to update order status after payment (payment_intent):', err);
      }
    }
  }

  res.status(200).send('OK');
}

/**
 * POST /api/payment/intent/mark-paid
 * Fallback endpoint to mark a PaymentIntent-based order as completed
 * after client-side confirmation, in case webhooks are not configured.
 * Body: { authUserId: string, orderId: number }
 */
router.post('/intent/mark-paid', express.json(), async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }

  try {
    const { authUserId, orderId } = req.body;
    if (!authUserId || !orderId) {
      return res.status(400).json({
        error: 'Missing required fields: authUserId, orderId',
      });
    }

    const userRes = await pool.query(
      'SELECT id FROM users WHERE auth_user_id = $1',
      [authUserId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    const orderRes = await pool.query(
      `SELECT id, user_id, status, session_id
       FROM orders
       WHERE id = $1 AND user_id = $2`,
      [orderId, userId]
    );
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const order = orderRes.rows[0];
    if (!order.session_id) {
      return res.status(400).json({ error: 'Order has no associated payment intent.' });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(order.session_id);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: `PaymentIntent is not succeeded (status: ${paymentIntent.status}).`,
      });
    }

    await pool.query(
      `UPDATE orders SET status = 'completed', updated_at = now() WHERE id = $1`,
      [orderId]
    );
    await incrementPromotionUsageForOrder(orderId);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Mark intent paid error:', err);
    res.status(500).json({
      error: err.message || 'Failed to mark order as paid.',
    });
  }
});
// Auto-cancel pending orders that have not completed within 5 minutes
const ORDER_TIMEOUT_MINUTES = 10;
setInterval(async () => {
  try {
    await pool.query(
      `UPDATE orders
       SET status = 'cancelled', updated_at = now()
       WHERE status = 'pending'
         AND created_at < now() - INTERVAL '${ORDER_TIMEOUT_MINUTES} minutes'`
    );
  } catch (err) {
    console.error("Failed to auto-cancel pending orders:", err);
  }
}, 60 * 1000);


export default router;
