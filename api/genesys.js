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

  const logSafeHeaders = (method, url, headers) => {
    console.log(`[REQUEST] ${method} para ${url}`);
    const safeHeaders = { ...headers };
    const authKey = safeHeaders.Authorization ? 'Authorization' : safeHeaders['api-secret'] ? 'api-secret' : '';
    if (authKey) {
      const value = String(safeHeaders[authKey] || '');
      safeHeaders[authKey] = value ? value.substring(0, 15) + '... (masked)' : '... (masked)';
    }
    console.log('HEADERS_ENVIADOS:', safeHeaders);
  };

  const sanitizePix = (data) => {
    if (!data || typeof data !== 'object') return data;
    if (data.pix && typeof data.pix === 'object' && data.pix.hasError) {
      delete data.pix;
    }
    return data;
  };
  const normalizePix = (data) => {
    if (!data || typeof data !== 'object') return data;
    const looksLikePix = (value) => {
      if (typeof value !== 'string') return false;
      const v = value.trim();
      return v.startsWith('000201') || v.includes('br.gov.bcb.pix');
    };
    const deepFindPix = (obj, depth = 0) => {
      if (!obj || depth > 6) return '';
      if (typeof obj === 'string') return looksLikePix(obj) ? obj : '';
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = deepFindPix(item, depth + 1);
          if (found) return found;
        }
        return '';
      }
      if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          const found = deepFindPix(obj[key], depth + 1);
          if (found) return found;
        }
      }
      return '';
    };
    const pick = (obj) => {
      if (!obj || typeof obj !== 'object') return '';
      return (
        obj.payload ||
        obj.copy_paste ||
        obj.copia_cola ||
        obj.pix_copy_and_paste ||
        obj.code ||
        obj.copy_and_paste ||
        obj.qr_code ||
        obj.emv ||
        obj.qr_code_text ||
        obj.pix_code ||
        ''
      );
    };
    const candidate = data.pix || data.payment_details || data.payment || data.charge || data.data || data;
    let payload = pick(candidate) || pick(data);
    if (!payload && data.point_of_interaction && data.point_of_interaction.transaction_data) {
      payload = data.point_of_interaction.transaction_data.qr_code || data.point_of_interaction.transaction_data.qr_code_base64 || '';
    }
    if (typeof candidate === 'string') payload = candidate;
    if (!payload) payload = deepFindPix(data);
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
      const headers = {
        'Content-Type': 'application/json',
        'api-secret': apiSecret,
      };
      const url = baseUrl + '/v1/transactions/' + id;
      logSafeHeaders('GET', url, headers);
      const response = await fetch(url, {
        method: 'GET',
        headers,
      });
      const data = await response.json().catch(() => null);
      console.log('RESPOSTA_GATEWAY:', JSON.stringify(data, null, 2));
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
  const paymentMethod = 'PIX';

  const plan = plans[planKey];
  const academy = {
    id: 'academy',
    label: 'Unlovable Academy',
    price: 37.0,
    title: 'Unlovable Academy',
  };

  const totalAmount = Number((plan.price + (academySelected ? academy.price : 0)).toFixed(2));

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
    payment_method: paymentMethod,
    webhook_url: webhookUrl,
    items: [
      {
        id: '1',
        title: 'Assinatura Unlovable',
        description: 'Assinatura Mensal Unlovable',
        price: totalAmount,
        quantity: 1,
        is_physical: false,
      },
    ],
    ip: body.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || undefined,
    customer: {
      name,
      email,
      phone,
      document_type: 'CPF',
      document,
    },
  };

  if (!webhookUrl) {
    delete transaction.webhook_url;
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      'api-secret': apiSecret,
    };
    const url = `${baseUrl}/v1/transactions`;
    console.log('PAYLOAD_ENVIADO:', JSON.stringify(body));
    console.log('PAYLOAD_AMOUNT_TYPE:', typeof totalAmount);
    logSafeHeaders('POST', url, headers);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(transaction),
    });

    const data = await response.json().catch(() => null);
    console.log('RESPOSTA_GATEWAY:', JSON.stringify(data, null, 2));
    const debug = {
      handler: 'api/genesys.js',
      webhook_sent: Boolean(webhookUrl),
      details_fetched: false,
      pix_fetched: false,
    };

    let finalData = data;
    const hasPixPayload = (value) => {
      const normalized = normalizePix(sanitizePix(value));
      if (!normalized || typeof normalized !== 'object') return false;
      const pix = normalized.pix;
      return Boolean(pix && typeof pix === 'object' && pix.payload);
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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

      if (!hasPixPayload(finalData)) {
        const maxAttempts = 10;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          await sleep(2000);
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

          if (hasPixPayload(finalData)) break;
        }
      }
    }

    if (finalData && typeof finalData === 'object') {
      const normalized = normalizePix(sanitizePix(finalData));
      const pixPayload = normalized && normalized.pix && normalized.pix.payload ? normalized.pix.payload : undefined;
      res.status(response.status).json({ ...normalized, pix_payload: pixPayload, debug });
      return;
    }

    res.status(response.status).json({ error: 'Resposta inválida do gateway.', debug });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao conectar no gateway.' });
  }
};







