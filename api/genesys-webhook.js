module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Genesys-Webhook', 'ok');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'MÃ©todo nÃ£o permitido.' });
    return;
  }

  // Endpoint simples para receber webhooks sem falhar o gateway.
  res.status(200).json({ ok: true });
};
