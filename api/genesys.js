const { randomUUID } = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Genesys-Handler', 'api/genesys.js');

  try {

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
  // Webhook desativado por padrão para evitar erro de validação no gateway.
  // Caso queira reativar no futuro, volte a ler GENESYS_WEBHOOK_URL aqui.
  const webhookUrl = '';

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

  const webhook = '';

  const transaction = {
    external_id: externalId,
    total_amount: totalAmount,
    payment_method: 'PIX',
    webhook_url: undefined,
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
    res.status(response.status).json(data || { error: 'Resposta inválida do gateway.' });
  } catch (error) {
    res.status(500).json({ error: 'Falha ao conectar no gateway.' });
  }
  } catch (error) {
    console.error('genesys handler error', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};


