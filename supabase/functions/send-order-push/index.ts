import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import webPush from 'npm:web-push@3.6.7'

type OrderRecord = {
  id: string
  order_number: number | string | null
  item_count: number | null
  total: number | string | null
}

type WebhookPayload = {
  type: 'INSERT' | string
  table: string
  schema: string
  record: OrderRecord | null
}

type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}

function safeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index]
  return mismatch === 0
}

function readSecretKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy

  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>
  return secretKeys.default || Object.values(secretKeys)[0] || ''
}

function orderNotification(order: OrderRecord) {
  const orderNumber = order.order_number
    ? `#${String(order.order_number).padStart(3, '0')}`
    : ''
  const itemCount = Math.max(0, Number(order.item_count) || 0)
  const total = Math.max(0, Number(order.total) || 0)
  const siteOrigin = Deno.env.get('ADMIN_SITE_ORIGIN') || 'https://lnksandwiches.emenu.workers.dev'

  const destination = `${siteOrigin}/admin.html#orders`
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: `New order ${orderNumber}`.trim(),
      body: `${itemCount} item${itemCount === 1 ? '' : 's'} · $${total.toFixed(2)}`,
      navigate: destination,
      icon: `${siteOrigin}/img/logo.png`,
      badge: `${siteOrigin}/img/logo.png`,
      tag: `order-${order.id}`,
      app_badge: '1',
      silent: false,
    },
    url: destination,
    appBadge: 1,
  })
}

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

    const webhookSecret = Deno.env.get('PUSH_WEBHOOK_SECRET') || ''
    const receivedSecret = request.headers.get('x-webhook-secret') || ''
    if (!webhookSecret || !safeEqual(receivedSecret, webhookSecret)) {
      return json({ error: 'Unauthorized.' }, 401)
    }

    const payload = await request.json() as WebhookPayload
    if (payload.type !== 'INSERT' || payload.schema !== 'public' || payload.table !== 'orders' || !payload.record) {
      return json({ error: 'Unsupported webhook payload.' }, 400)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const secretKey = readSecretKey()
    if (!supabaseUrl || !secretKey) return json({ error: 'Supabase server credentials are unavailable.' }, 500)

    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || ''
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''
    if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
      return json({ error: 'VAPID secrets are incomplete.' }, 500)
    }

    webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: subscriptions, error } = await supabase
      .from('push_subscriptions')
      .select('endpoint,p256dh,auth')

    if (error) return json({ error: 'Could not load push subscriptions.' }, 500)
    const message = orderNotification(payload.record)
    const expiredEndpoints: string[] = []
    let delivered = 0
    let failed = 0

    await Promise.all((subscriptions as PushSubscriptionRow[] || []).map(async subscription => {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, message, { TTL: 300, urgency: 'high' })
        delivered += 1
      } catch (pushError) {
        const statusCode = Number((pushError as { statusCode?: number }).statusCode || 0)
        if (statusCode === 404 || statusCode === 410) expiredEndpoints.push(subscription.endpoint)
        failed += 1
        console.error(JSON.stringify({ message: 'Push delivery failed', statusCode }))
      }
    }))

    if (expiredEndpoints.length) {
      const { error: cleanupError } = await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints)
      if (cleanupError) console.error(JSON.stringify({ message: 'Expired subscription cleanup failed' }))
    }

    return json({ ok: true, delivered, failed, removed: expiredEndpoints.length })
  },
}
