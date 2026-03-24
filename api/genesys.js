module.exports.config = { runtime: 'nodejs' };

const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  const fetchPixImage = async (url, apiSecret) => {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'api-secret': apiSecret,
      },
    });
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => null);
      return { type: 'json', data };
    }
    if (contentType.includes('image/')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const base64 = buffer.toString('base64');
      return { type: 'image', data: base64, contentType };
    }
    const data = await res.text().catch(() => '');
    return { type: 'text', data };
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Genesys-Handler', 'api/genesys.js');
  res.setHeader('X-Genesys-Handler-Version', '2026-03-24');

  const sanitizePix = (data) => {
    if (!data || typeof data !== 'object') return data;
    if (data.pix && typeof data.pix === 'object' && data.pix.hasError) {
      delete data.pix;
    }
    return data;
  };
  const normalizePix = (data) => {
    if (!data || typeof data !== 'object') return data;
    const pick = (obj) => {
      if (!obj || typeof obj !== 'object') return '';
      return (
        obj.payload ||
        obj.copy_paste ||
        obj.copia_cola ||
        obj.code ||
        obj.emv ||
        obj.qr_code_text ||
        obj.pix_code ||
        ''
      );
    };
    const candidate = data.pix || data.payment_details || data.payment || data.charge || data.data || data;
    let payload = pick(candidate) || pick(data);
    if (typeof candidate === 'string') payload = candidate;
    if (payload) data.pix = { payload };
    return data;
  };

  if (req.method === 'GET') {
    const apiSecret = process.env.GENESYS_API_SECRET;
    if (!apiSecret) {
      res.status(500).json({ error: 'GENESYS_API_SECRET não configurado no servidor.' });
      return;
    }
    const baseUrl = (process.env.GENESYS_BASE_URL || 'https://api.genesys.finance').replace(/\/+$/, '');
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const id = (req.query && req.query.id) || url.searchParams.get('id');
    if (!id) {
      res.status(400).json({ error: 'ID da transação não informado.' });
      return;
    }
    try {
      const response = await fetch(baseUrl + '/v1/transactions/' + id, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'api-secret': apiSecret,
        },
      });
      const data = await response.json().catch(() => null);
      if (data && typeof data === 'object' && !data.pix) {
        try {
          const pixRes = await fetch(baseUrl + '/v1/transactions/' + id + '/pix', {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'api-secret': apiSecret,
            },
          });
          const pixData = await pixRes.json().catch(() => null);
          if (pixData && typeof pixData === 'object') {
            data.pix = pixData;
          }
        } catch (err) {}
      }
      res.status(response.status).json(normalizePix(sanitizePix(data)) || { error: 'Resposta inválida do gateway.' });
    } catch (error) {
      res.status(500).json({ error: 'Falha ao conectar no gateway.' });
    }
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch (parseError) {
      body = {};
    }
  }
  body = body || {};

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const rawPhone = String(body.phone || '').trim();
  const documentTypeInput = String(body.document_type || 'CPF').trim();
  const rawDocument = String(body.document || '').trim();
  const planKey = String(body.plan || 'mensal').trim();
  const academySelected = Boolean(body.academy);

  const onlyDigits = (value) => String(value || '').replace(/\D+/g, '');
  const phoneDigits = onlyDigits(rawPhone);
  const documentDigits = onlyDigits(rawDocument);
  const phone = phoneDigits.startsWith('55') ? phoneDigits : (phoneDigits ? `55${phoneDigits}` : '');
  const document = documentDigits;
  const inferredDocumentType = document.length === 14 ? 'CNPJ' : 'CPF';
  const documentType =
    documentTypeInput.toUpperCase() === 'CNPJ' || documentTypeInput.toUpperCase() === 'CPF'
      ? documentTypeInput.toUpperCase()
      : inferredDocumentType;

  if (!name || !email || !phone || !documentType || !document) {
    res.status(422).json({ error: 'Campos obrigatórios ausentes.' });
    return;
  }

  const plans = {
    mensal: { label: 'Plano Mensal', price: 57.0, title: 'Assinatura Mensal' },
    trimestral: { label: 'Plano Trimestral', price: 167.0, title: 'Assinatura Trimestral' },
  };

  if (!plans[planKey]) {
    res.status(422).json({ error: 'Plano inválido.' });
    return;
  }

  const apiSecret = process.env.GENESYS_API_SECRET;
  if (!apiSecret) {
    res.status(500).json({ error: 'GENESYS_API_SECRET não configurado no servidor.' });
    return;
  }

  const baseUrl = (process.env.GENESYS_BASE_URL || 'https://api.genesys.finance').replace(/\/+$/, '');

  const plan = plans[planKey];
  const academy = {
    id: 'academy',
    label: 'Unlovable Academy',
    price: 37.0,
    title: 'Unlovable Academy',
  };

  const totalAmount = plan.price + (academySelected ? academy.price : 0);

  const externalIdInput = String(body.external_id || '').trim();
  const externalId =
    externalIdInput ||
    (typeof randomUUID === 'function'
      ? randomUUID()
      : `ulv_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const webhookUrl = host ? `${proto}://${host}/api/genesys-webhook` : '';

  const transaction = {
    external_id: externalId,
    total_amount: totalAmount,
    payment_method: 'PIX',
    webhook_url: webhookUrl,
    items: [
      {
        id: planKey,
        title: plan.title,
        description: plan.label,
        price: plan.price,
        quantity: 1,
        is_physical: false,
      },
    ],
    ip: body.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || undefined,
    customer: {
      name,
      email,
      phone,
      document_type: documentType,
      document,
    },
  };

  if (!webhookUrl) {
    delete transaction.webhook_url;
  }

  if (academySelected) {
    transaction.items.push({
      id: academy.id,
      title: academy.title,
      description: academy.label,
      price: academy.price,
      quantity: 1,
      is_physical: false,
    });
  }

  try {
    const response = await fetch(`${baseUrl}/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-secret': apiSecret,
      },
      body: JSON.stringify(transaction),
    });

    const data = await response.json().catch(() => null);
    const debug = {
      handler: 'api/genesys.js',
      webhook_sent: Boolean(webhookUrl),
      details_fetched: false,
      pix_fetched: false,
    };

    let finalData = data;
    if (data && typeof data === 'object' && data.id) {
      try {
        const detailsRes = await fetch(`${baseUrl}/v1/transactions/${data.id}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'api-secret': apiSecret,
          },
        });
        const details = await detailsRes.json().catch(() => null);
        if (details && typeof details === 'object') {
          finalData = details;
          debug.details_fetched = true;
        }
      } catch (err) {}

      if (finalData && typeof finalData === 'object' && !finalData.pix) {
        try {
          const pixRes = await fetch(`${baseUrl}/v1/transactions/${data.id}/pix`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'api-secret': apiSecret,
            },
          });
          const pixData = await pixRes.json().catch(() => null);
          if (pixData && typeof pixData === 'object') {
            finalData.pix = pixData;
            debug.pix_fetched = true;
          }
        } catch (err) {}
      }
    }

    if (finalData && typeof finalData === 'object') {
      res.status(response.status).json({ ...normalizePix(sanitizePix(finalData)), debug });
      return;
    }

    res.status(response.status).json({ error: 'Resposta inválida do gateway.', debug });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao conectar no gateway.' });
  }
};







