module.exports.config = { runtime: 'nodejs' };

const fs = require('fs');

const DEFAULT_BASE_URL = 'https://api.zeroonepay.com.br/api/public/v1';

const onlyDigits = (value = '') => String(value || '').replace(/\D+/g, '');

const normalizeCents = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (Number.isInteger(value)) return value;
  const raw = String(value).trim();
  if (!raw) return null;
  let v = raw.replace(/R\$|\$/g, '').replace(/\s+/g, '');
  if (v.includes(',') || v.includes('.')) {
    v = v.replace(/\./g, '').replace(',', '.');
    const num = Number(v);
    if (Number.isNaN(num)) return null;
    return Math.round(num * 100);
  }
  const num = Number(v);
  if (Number.isNaN(num)) return null;
  return Math.round(num);
};

const extractProductsList = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.products)) return payload.products;
  return Array.isArray(payload) ? payload : [];
};

const extractProductIdentity = (product) => {
  const id = product?.id ?? product?.product_id ?? product?.code ?? '';
  const sku = product?.sku ?? product?.ref ?? product?.reference ?? '';
  const name = product?.name ?? product?.title ?? product?.description ?? '';
  const price = product?.price ?? product?.amount ?? product?.value ?? product?.price_cents ?? product?.amount_cents ?? null;
  return {
    id: id ? String(id) : '',
    sku: sku ? String(sku) : '',
    name: name ? String(name) : '',
    price_cents: normalizeCents(price),
  };
};

const extractItemRequest = (input, transaction) => {
  let item = null;
  if (transaction?.item && typeof transaction.item === 'object') item = transaction.item;
  if (!item && input?.item && typeof input.item === 'object') item = input.item;
  if (!item && Array.isArray(transaction?.items) && transaction.items[0]) item = transaction.items[0];
  if (!item && Array.isArray(input?.items) && input.items[0]) item = input.items[0];
  const id = item?.id ?? item?.product_id ?? input?.product_id ?? input?.item_id ?? '';
  const sku = item?.sku ?? item?.ref ?? input?.product_sku ?? input?.sku ?? '';
  const name = item?.name ?? item?.title ?? input?.product_name ?? input?.name_item ?? '';
  return {
    id: id ? String(id) : '',
    sku: sku ? String(sku) : '',
    name: name ? String(name) : '',
  };
};

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  await new Promise((resolve) => {
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', resolve);
  });
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-ZeroOnePay-Handler', 'api/zeroonepay.js');

  try {
    const apiToken = process.env.ZEROONEPAY_API_TOKEN;
    if (!apiToken) {
      res.status(500).json({ error: 'ZEROONEPAY_API_TOKEN nao configurado no servidor.' });
      return;
    }

    const baseUrl = (process.env.ZEROONEPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const method = (req.method || 'GET').toUpperCase();
    const resource = String(req.query?.resource || '').toLowerCase();

    if (method === 'GET') {
      if (!['products', 'balance', 'transactions'].includes(resource)) {
        res.status(400).json({ error: 'Recurso invalido. Use ?resource=products, ?resource=balance ou ?resource=transactions.' });
        return;
      }
      const query = { ...req.query, api_token: apiToken };
      delete query.resource;
      const headers = { 'Content-Type': 'application/json' };

      if (resource === 'transactions') {
        const id = query.id || query.transaction_id || query.transaction_hash;
        if (id) {
          delete query.id;
          delete query.transaction_id;
          delete query.transaction_hash;
          const url = `${baseUrl}/transactions/${encodeURIComponent(String(id))}?${new URLSearchParams({ api_token: apiToken, ...query })}`;
          const response = await fetch(url, { method: 'GET', headers });
          const text = await response.text();
          if (response.status !== 404) {
            res.status(response.status || 200).send(text);
            return;
          }
        }
        const url = `${baseUrl}/transactions?${new URLSearchParams(query)}`;
        const response = await fetch(url, { method: 'GET', headers });
        const text = await response.text();
        res.status(response.status || 200).send(text);
        return;
      }

      const url = `${baseUrl}/${resource}?${new URLSearchParams(query)}`;
      const response = await fetch(url, { method: 'GET', headers });
      const text = await response.text();
      res.status(response.status || 200).send(text);
      return;
    }

    if (method !== 'POST') {
      res.status(405).json({ error: 'Metodo nao permitido.' });
      return;
    }

    const input = await readBody(req);
    const transaction = input?.transaction && typeof input.transaction === 'object' ? input.transaction : {};
    const customer =
      transaction?.customer && typeof transaction.customer === 'object'
        ? transaction.customer
        : input?.customer && typeof input.customer === 'object'
          ? input.customer
          : {};

  const name = String(customer?.name || input?.name || '').trim();
  const email = String(customer?.email || input?.email || '').trim();
  const document = onlyDigits(String(customer?.document || input?.document || ''));
  const phone = String(customer?.phone || input?.phone || '').trim();

  const amountInput =
    transaction?.amount ??
    transaction?.value ??
    transaction?.amount_cents ??
    input?.amount ??
    input?.value ??
    input?.amount_cents ??
    null;
  const amountCents = normalizeCents(amountInput);

  let paymentMethod = String(
    transaction?.payment_method || input?.payment_method || input?.method || '',
  )
    .trim()
    .toLowerCase();
  if (paymentMethod === 'card') paymentMethod = 'credit_card';
  if (paymentMethod === 'cartao' || paymentMethod === 'cartao_credito' || paymentMethod === 'creditcard') {
    paymentMethod = 'credit_card';
  }
  if (paymentMethod === 'pix') paymentMethod = 'pix';
  if (paymentMethod === 'boleto' || paymentMethod === 'billet') paymentMethod = 'billet';
  if (!paymentMethod) paymentMethod = 'pix';

  if (!name || !email || !document || !amountCents || !paymentMethod) {
    res.status(422).json({ error: 'Campos obrigatorios ausentes.' });
    return;
  }

  const offerHash = String(
    transaction?.offer_hash ||
      input?.offer_hash ||
      input?.product_hash ||
      input?.product_id ||
      input?.hash ||
      '',
  ).trim();
  if (!offerHash) {
    res.status(422).json({ error: 'offer_hash obrigatorio.' });
    return;
  }
  transaction.offer_hash = offerHash;

  const productHash = String(
    transaction?.product_hash || input?.product_hash || input?.product_id || input?.hash || '',
  ).trim();
  if (!productHash) {
    res.status(422).json({ error: 'product_hash obrigatorio.' });
    return;
  }
  transaction.product_hash = productHash;

  const cart = transaction?.cart || input?.cart;
  if (!cart || (Array.isArray(cart) && cart.length === 0)) {
    res.status(422).json({ error: 'cart obrigatorio.' });
    return;
  }
  let normalizedCart = cart;
  if (Array.isArray(cart)) {
    normalizedCart = cart.map((item) => {
      if (!item || typeof item !== 'object') return item;
      const title = item.title || item.name || '';
      return {
        ...item,
        title: title || item.title,
        name: item.name || title,
        product_hash: item.product_hash || productHash,
        offer_hash: item.offer_hash || offerHash,
      };
    });
  }
  const gatewayCustomer = {
    name,
    email,
    document,
  };
  if (phone) gatewayCustomer.phone = phone;

  const gatewayPayload = {
    api_token: apiToken,
    offer_hash: offerHash,
    product_hash: productHash,
    payment_method: paymentMethod,
    customer: gatewayCustomer,
    cart: normalizedCart,
  };
  gatewayPayload.amount = amountCents;
  if (input?.external_id || transaction?.external_id) {
    gatewayPayload.external_id = input?.external_id || transaction?.external_id;
  }
  if (input?.webhook_url || transaction?.webhook_url) {
    gatewayPayload.webhook_url = input?.webhook_url || transaction?.webhook_url;
  }

  const itemIdentity = extractItemRequest(input, transaction);
  if (itemIdentity.id || itemIdentity.sku || itemIdentity.name) {
    const productsUrl = `${baseUrl}/products?${new URLSearchParams({ api_token: apiToken })}`;
    const productsRes = await fetch(productsUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!productsRes.ok) {
      res.status(502).json({ error: 'Falha ao validar produto no gateway.' });
      return;
    }
    const productsPayload = await productsRes.json().catch(() => null);
    const products = extractProductsList(productsPayload);
    let found = null;
    for (const product of products) {
      if (!product || typeof product !== 'object') continue;
      const identity = extractProductIdentity(product);
      const matchId = itemIdentity.id && identity.id && itemIdentity.id === identity.id;
      const matchSku = itemIdentity.sku && identity.sku && itemIdentity.sku === identity.sku;
      const matchName =
        itemIdentity.name && identity.name && itemIdentity.name.toLowerCase() === identity.name.toLowerCase();
      if (matchId || matchSku || matchName) {
        found = identity;
        break;
      }
    }
    if (!found) {
      res.status(422).json({ error: 'Produto nao encontrado para validacao.' });
      return;
    }
    if (found.price_cents !== null && found.price_cents !== amountCents) {
      res.status(422).json({ error: 'Valor do produto divergente do cadastrado.' });
      return;
    }
  }

    const response = await fetch(`${baseUrl}/transactions?${new URLSearchParams({ api_token: apiToken })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(gatewayPayload),
    });

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const text = await response.text();
    const status = response.status || 502;

    if (response.ok) {
      res.status(status).send(text);
      return;
    }

    if (contentType.includes('application/json')) {
      res.status(status).send(text);
      return;
    }

    const snippet = text ? text.slice(0, 800) : '';
    res.status(status).json({
      success: false,
      gateway_status: status,
      gateway_body: snippet,
    });
  } catch (err) {
    console.error('ZEROONEPAY_HANDLER_ERROR', err);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
