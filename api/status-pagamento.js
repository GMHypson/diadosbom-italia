// Vercel Serverless Function — GET /api/status-pagamento?id=<payment_id>
// Consulta o status de um pagamento XXPay sem expor o secret no front.

const CLIENT_ID     = process.env.XXPAY_CLIENT_ID     || 'xxc_1dcb0qb6z93nyjdaon0fmlhfpua6';
const CLIENT_SECRET = process.env.XXPAY_CLIENT_SECRET || 'xxs_MUr8CQCk3Q0DSPkM8FMsmI60ijTMQJCJElSDirUN';
const BASE_URL      = 'https://api.xxpayconnect.com/api/v1/public';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  try {
    const upstream = await fetch(`${BASE_URL}/payments/${encodeURIComponent(id)}`, {
      headers: {
        'X-Client-Id':     CLIENT_ID,
        'X-Client-Secret': CLIENT_SECRET,
      },
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[status-pagamento] fetch error:', err);
    return res.status(502).json({ error: 'acquirer_unavailable', detail: err.message });
  }
}
