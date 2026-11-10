// Vercel Serverless Function — POST /api/webhook-pagamento
// Recebe notificações da XXPay e valida a assinatura HMAC-SHA256.
// Signature: X-Signature = "sha256=" + HMAC-SHA256("X-Timestamp.rawBody", WEBHOOK_SECRET)

import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.XXPAY_WEBHOOK_SECRET || 'cbs_KGowRc7rdhCCjDqp2N5aoD0Y2Xbb87lhZaFVYCiJ';

export const config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function verifySignature(rawBody, timestamp, receivedSig) {
  const payload = `${timestamp}.${rawBody}`;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let rawBody;
  try { rawBody = await readRawBody(req); }
  catch { return res.status(400).end(); }

  const timestamp = req.headers['x-timestamp'] || '';
  const signature = req.headers['x-signature'] || '';

  if (!verifySignature(rawBody.toString('utf8'), timestamp, signature)) {
    console.warn('[webhook] assinatura inválida');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'json_inválido' }); }

  const { id: deliveryId, event: eventType, data: payment } = event;

  console.log(`[webhook] ${eventType} — payment=${payment?.id} delivery=${deliveryId}`);

  // Processar de forma idempotente pelo X-Delivery
  if (eventType === 'payment.paid') {
    // Pagamento confirmado — aqui você pode:
    // • Registrar num banco de dados (Vercel KV, Supabase, etc.)
    // • Enviar e-mail de confirmação
    // • Notificar o seller via split
    console.log(`[webhook] ✅ PAGO — ${payment?.id} — ${payment?.amount} ${payment?.currency}`);
  } else if (eventType === 'payment.failed') {
    console.log(`[webhook] ❌ FALHOU — ${payment?.id}`);
  }

  // Responder 2xx em até 10s (obrigatório pela XXPay para não reenviar)
  return res.status(200).json({ received: true });
}
