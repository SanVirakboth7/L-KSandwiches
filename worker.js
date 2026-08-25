const PAYWAY_ORIGINS = Object.freeze({
  sandbox: 'https://checkout-sandbox.payway.com.kh',
  production: 'https://checkout.payway.com.kh'
});

const encoder = new TextEncoder();

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function payWayOrigin(env) {
  return PAYWAY_ORIGINS[env.PAYWAY_ENV] || PAYWAY_ORIGINS.sandbox;
}

function formatPayWayTime(date = new Date()) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function utf8ToBase64(value) {
  return bytesToBase64(encoder.encode(value));
}

async function hmacSha512Base64(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64(new Uint8Array(signature));
}

async function constantTimeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function readBoundedJson(request, maximumBytes = 32768) {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maximumBytes) throw new Error('Request is too large.');

  const text = await request.text();
  if (encoder.encode(text).byteLength > maximumBytes) throw new Error('Request is too large.');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function normalizeOrderRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('Order details are required.');

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length < 1 || rawItems.length > 20) {
    throw new Error('An order must contain between 1 and 20 products.');
  }

  const items = rawItems.map(item => {
    const id = String(item?.id || '').trim();
    const quantity = Number(item?.quantity);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('A product ID is invalid.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error('A product quantity is invalid.');
    }
    return { id, quantity };
  });

  const duplicateIds = new Set();
  for (const item of items) {
    if (duplicateIds.has(item.id)) throw new Error('Duplicate products are not allowed.');
    duplicateIds.add(item.id);
  }

  return {
    items,
    customer: {
      name: String(input.customer?.name || '').trim().slice(0, 100),
      phone: String(input.customer?.phone || '').trim().slice(0, 30)
    }
  };
}

async function fetchAuthoritativeProducts(env, itemIds) {
  const endpoint = new URL('/rest/v1/products', env.SUPABASE_URL);
  endpoint.searchParams.set('select', 'id,name,price,is_out_of_stock');
  endpoint.searchParams.set('id', `in.(${itemIds.join(',')})`);

  const response = await fetch(endpoint, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
    }
  });

  if (!response.ok) throw new Error('The menu could not be verified. Please try again.');
  const products = await response.json();
  if (!Array.isArray(products)) throw new Error('The menu response was invalid.');
  return products;
}

function priceToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('A product price is invalid.');
  return Math.round(amount * 100);
}

function buildPayWayItems(lines, totalCents) {
  const fullItems = lines.map(line => ({
    name: String(line.name || 'Menu item').slice(0, 40),
    quantity: line.quantity,
    price: (line.unitCents / 100).toFixed(2)
  }));
  const encoded = utf8ToBase64(JSON.stringify(fullItems));
  if (encoded.length <= 500) return encoded;

  return utf8ToBase64(JSON.stringify([{
    name: 'L&K Sandwiches Order',
    quantity: 1,
    price: (totalCents / 100).toFixed(2)
  }]));
}

function splitLatinName(value) {
  const safe = value.replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!safe) return { firstname: '', lastname: '' };
  const [firstname, ...rest] = safe.split(' ');
  return { firstname: firstname.slice(0, 100), lastname: rest.join(' ').slice(0, 100) };
}

function newTransactionId() {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `LK${time}${random}`.slice(0, 20);
}

async function createPayWayPayment(request, env) {
  const requestOrigin = request.headers.get('Origin');
  const siteOrigin = new URL(request.url).origin;
  if (requestOrigin && requestOrigin !== siteOrigin) return jsonResponse({ error: 'Origin not allowed.' }, 403);
  if (!request.headers.get('Content-Type')?.includes('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json.' }, 415);
  }
  if (!env.PAYWAY_MERCHANT_ID || !env.PAYWAY_API_KEY) {
    return jsonResponse({ error: 'ABA PayWay has not been configured yet.' }, 503);
  }

  const order = normalizeOrderRequest(await readBoundedJson(request));
  const products = await fetchAuthoritativeProducts(env, order.items.map(item => item.id));
  const productMap = new Map(products.map(product => [String(product.id), product]));

  let totalCents = 0;
  const lines = order.items.map(item => {
    const product = productMap.get(item.id);
    if (!product) throw new Error('A product is no longer available.');
    if (product.is_out_of_stock) throw new Error(`${product.name || 'A product'} is out of stock.`);
    const unitCents = priceToCents(product.price);
    totalCents += unitCents * item.quantity;
    return { name: product.name, quantity: item.quantity, unitCents };
  });

  if (totalCents < 1) throw new Error('The order total is invalid.');

  const tranId = newTransactionId();
  const reqTime = formatPayWayTime();
  const amount = (totalCents / 100).toFixed(2);
  const items = buildPayWayItems(lines, totalCents);
  const { firstname, lastname } = splitLatinName(order.customer.name);
  const phone = order.customer.phone.replace(/\D/g, '').slice(0, 20);
  const returnUrl = utf8ToBase64(`${siteOrigin}/api/payway/callback`);
  const cancelUrl = `${siteOrigin}/?payway=cancelled`;
  const continueSuccessUrl = `${siteOrigin}/?payway=return&tran_id=${encodeURIComponent(tranId)}`;

  const fields = {
    req_time: reqTime,
    merchant_id: env.PAYWAY_MERCHANT_ID,
    tran_id: tranId,
    amount,
    items,
    shipping: '0.00',
    firstname,
    lastname,
    email: '',
    phone,
    type: 'purchase',
    payment_option: 'abapay_khqr',
    return_url: returnUrl,
    cancel_url: cancelUrl,
    continue_success_url: continueSuccessUrl,
    return_deeplink: '',
    currency: 'USD',
    custom_fields: '',
    return_params: JSON.stringify({ tran_id: tranId }),
    payout: '',
    lifetime: '15',
    additional_params: '',
    google_pay_token: '',
    skip_success_page: '1',
    view_type: 'hosted_view',
    payment_gate: '0'
  };

  const beforeHash = [
    fields.req_time,
    fields.merchant_id,
    fields.tran_id,
    fields.amount,
    fields.items,
    fields.shipping,
    fields.firstname,
    fields.lastname,
    fields.email,
    fields.phone,
    fields.type,
    fields.payment_option,
    fields.return_url,
    fields.cancel_url,
    fields.continue_success_url,
    fields.return_deeplink,
    fields.currency,
    fields.custom_fields,
    fields.return_params,
    fields.payout,
    fields.lifetime,
    fields.additional_params,
    fields.google_pay_token,
    fields.skip_success_page
  ].join('');

  fields.hash = await hmacSha512Base64(beforeHash, env.PAYWAY_API_KEY);

  return jsonResponse({
    gatewayUrl: `${payWayOrigin(env)}/api/payment-gateway/v1/payments/purchase`,
    tranId,
    amount,
    fields
  });
}

async function checkPayWayPayment(request, env) {
  if (!env.PAYWAY_MERCHANT_ID || !env.PAYWAY_API_KEY) {
    return jsonResponse({ error: 'ABA PayWay has not been configured yet.' }, 503);
  }

  const tranId = new URL(request.url).searchParams.get('tran_id') || '';
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(tranId)) {
    return jsonResponse({ error: 'Transaction ID is invalid.' }, 400);
  }

  const reqTime = formatPayWayTime();
  const hash = await hmacSha512Base64(
    `${reqTime}${env.PAYWAY_MERCHANT_ID}${tranId}`,
    env.PAYWAY_API_KEY
  );
  const upstream = await fetch(
    `${payWayOrigin(env)}/api/payment-gateway/v1/payments/check-transaction-2`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        req_time: reqTime,
        merchant_id: env.PAYWAY_MERCHANT_ID,
        tran_id: tranId,
        hash
      })
    }
  );
  const result = await upstream.json();
  if (!upstream.ok || result?.status?.code !== '00') {
    return jsonResponse({
      error: result?.status?.message || 'Payment status is unavailable.'
    }, 502);
  }

  const paymentStatus = String(result?.data?.payment_status || 'UNKNOWN').toUpperCase();
  return jsonResponse({
    tranId,
    approved: result?.data?.payment_status_code === 0 || paymentStatus === 'APPROVED',
    status: paymentStatus,
    amount: Number(result?.data?.payment_amount ?? result?.data?.total_amount ?? 0),
    currency: result?.data?.payment_currency || 'USD'
  });
}

async function handlePayWayCallback(request, env) {
  if (!env.PAYWAY_API_KEY) return jsonResponse({ error: 'Payment callback is not configured.' }, 503);

  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > 16384) return jsonResponse({ error: 'Callback is too large.' }, 413);
  const rawBody = await request.text();
  if (encoder.encode(rawBody).byteLength > 16384) return jsonResponse({ error: 'Callback is too large.' }, 413);

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'Callback body is invalid.' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ error: 'Callback body is invalid.' }, 400);
  }

  const beforeHash = Object.keys(payload)
    .sort()
    .map(key => {
      const value = payload[key];
      return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    })
    .join('');
  const expectedSignature = await hmacSha512Base64(beforeHash, env.PAYWAY_API_KEY);
  const receivedSignature = request.headers.get('X-PayWay-HMAC-SHA512') || '';

  if (!receivedSignature || !(await constantTimeEqual(receivedSignature, expectedSignature))) {
    return jsonResponse({ error: 'Invalid callback signature.' }, 401);
  }

  console.log(JSON.stringify({
    message: 'PayWay callback verified',
    tranId: String(payload.tran_id || ''),
    status: String(payload.status || '')
  }));
  return jsonResponse({ ok: true });
}

async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/payway/create' && request.method === 'POST') {
    return createPayWayPayment(request, env);
  }
  if (url.pathname === '/api/payway/check' && request.method === 'GET') {
    return checkPayWayPayment(request, env);
  }
  if (url.pathname === '/api/payway/callback' && request.method === 'POST') {
    return handlePayWayCallback(request, env);
  }
  if (url.pathname.startsWith('/api/')) return jsonResponse({ error: 'Not found.' }, 404);

  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      console.error(JSON.stringify({
        message: 'PayWay request failed',
        error: message,
        path: new URL(request.url).pathname
      }));
      const status = /invalid|required|available|stock|large|duplicate/i.test(message) ? 400 : 500;
      return jsonResponse({ error: message }, status);
    }
  }
};
