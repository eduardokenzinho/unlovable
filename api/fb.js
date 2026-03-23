const crypto = require('crypto');

const normalizeAndHash = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

const normalizePhone = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/\D+/g, '');
  return normalized || null;
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, message: 'fb-api ready', test: 'POST only' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

  const pixelId = process.env.FB_PIXEL_ID;
  const accessToken = process.env.FB_ACCESS_TOKEN;
  const defaultTestEventCode = process.env.FB_TEST_EVENT_CODE || '';

  if (!pixelId || !accessToken) {
    res.status(200).json({ ok: true, disabled: true, message: 'FB env vars ausentes' });
    return;
  }

  const event = {
    event_name: body.event_name || 'PageView',
    event_time: body.event_time ? Number(body.event_time) : Math.floor(Date.now() / 1000),
    action_source: body.action_source || 'website',
    event_source_url: body.event_source_url || `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}${req.url}`,
    user_data: {
      client_ip_address: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      client_user_agent: req.headers['user-agent'],
      fbc: req.cookies?._fbc,
      fbp: req.cookies?._fbp,
      em: normalizeAndHash(body.user_data?.em),
      ph: normalizeAndHash(normalizePhone(body.user_data?.ph)),
      fn: normalizeAndHash(body.user_data?.fn),
      ln: normalizeAndHash(body.user_data?.ln),
      external_id: normalizeAndHash(body.user_data?.external_id),
    },
  };

  if (body.custom_data && typeof body.custom_data === 'object') {
    event.custom_data = body.custom_data;
  }

  const payload = {
    data: [event],
  };

  if (defaultTestEventCode || body.test_event_code) {
    payload.test_event_code = body.test_event_code || defaultTestEventCode;
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    const data = await response.json().catch(() => null);
    res.status(response.status).json(data || { ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao enviar evento para o Facebook.' });
  }
};
