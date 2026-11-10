// Vercel Serverless Function — POST /api/criar-pagamento
// Cria um pagamento XXPay via Satispay (EUR) sem expor o client_secret no front.

const CLIENT_ID     = process.env.XXPAY_CLIENT_ID     || 'xxc_1dcb0qb6z93nyjdaon0fmlhfpua6';
const CLIENT_SECRET = process.env.XXPAY_CLIENT_SECRET || 'xxs_MUr8CQCk3Q0DSPkM8FMsmI60ijTMQJCJElSDirUN';
const BASE_URL      = 'https://api.xxpayconnect.com/api/v1/public';

export default async function handler(req, res) {
  // CORS — só permite a origem do próprio funil
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'JSON inválido' }); }

  const { amount, name, email, external_reference, return_url, callback_url } = body || {};

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    return res.status(422).json({ error: 'amount inválido' });
  }
  if (!name)  return res.status(422).json({ error: 'name obrigatório' });
  if (!email) return res.status(422).json({ error: 'email obrigatório' });

  const idempotencyKey = `ita-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    amount:   Number(Number(amount).toFixed(2)),
    currency: 'EUR',
    method:   'satispay',
    description: 'Verifica Identità – Sblocco Saldo TikTok',
    external_reference: external_reference || `checkout-${idempotencyKey}`,
    payer: {
      name,
      email,
      country: 'IT',
    },
    ...(return_url   && { return_url }),
    ...(callback_url && { callback_url }),
  };

  try {
    const upstream = await fetch(`${BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-Client-Id':     CLIENT_ID,
        'X-Client-Secret': CLIENT_SECRET,
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    if (upstream.status === 201) {
      return res.status(201).json(data);
    }

    // Repassa o erro da adquirente com o status correto
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[criar-pagamento] fetch error:', err);
    return res.status(502).json({ error: 'acquirer_unavailable', detail: err.message });
  }
}
