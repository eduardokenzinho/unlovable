module.exports.config = { runtime: 'nodejs' };

const fs = require('fs');
const { Pool } = require('pg');

const getPool = () => {
  if (!process.env.DATABASE_URL) return null;
  if (!global._zeroonepayPool) {
    global._zeroonepayPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false },
    });
  }
  return global._zeroonepayPool;
};

const ensureTable = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zeroonepay_webhooks (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL,
      ip TEXT,
      transaction_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER,
      payment_method TEXT,
      paid_at TIMESTAMPTZ,
      payload JSONB NOT NULL
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_zeroonepay_hash ON zeroonepay_webhooks (transaction_hash);`);
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-ZeroOnePay-Webhook', 'ok');

  if ((req.method || 'POST').toUpperCase() !== 'POST') {
    res.status(405).json({ error: 'Metodo nao permitido.' });
    return;
  }

  let payload = req.body;
  if (!payload || typeof payload !== 'object') {
    let raw = '';
    await new Promise((resolve) => {
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', resolve);
    });
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      payload = null;
    }
  }

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'Payload invalido.' });
    return;
  }

  const transactionHash = String(payload.transaction_hash || '').trim();
  const status = String(payload.status || '').trim();
  const amount = payload.amount ?? null;
  const paymentMethod = payload.payment_method ?? null;
  const paidAt = payload.paid_at ?? null;

  if (!transactionHash || !status) {
    res.status(422).json({ error: 'Campos obrigatorios ausentes.' });
    return;
  }

  let logged = false;
  let dbError = null;
  try {
    const pool = getPool();
    if (pool) {
      await ensureTable(pool);
      await pool.query(
        `
          INSERT INTO zeroonepay_webhooks
            (received_at, ip, transaction_hash, status, amount, payment_method, paid_at, payload)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          new Date(),
          req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
          transactionHash,
          status,
          amount,
          paymentMethod,
          paidAt ? new Date(paidAt) : null,
          payload,
        ],
      );
      logged = true;
    } else {
      const logFile = '/tmp/zeroonepay-webhook.log';
      const entry = {
        received_at: new Date().toISOString(),
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
        transaction_hash: transactionHash,
        status,
        amount,
        payment_method: paymentMethod,
        paid_at: paidAt,
        payload,
      };
      fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
      logged = true;
    }
  } catch (err) {
    dbError = err ? String(err.message || err) : 'db_error';
  }

  res.status(200).json({
    received: true,
    logged,
    transaction_hash: transactionHash,
    status,
    amount,
    payment_method: paymentMethod,
    paid_at: paidAt,
    db_error: dbError,
  });
};
