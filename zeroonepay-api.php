<?php
header('Content-Type: application/json; charset=utf-8');
header('X-ZeroOnePay-Handler: zeroonepay-api.php');

const ZEROONEPAY_DEFAULT_BASE_URL = 'https://api.zeroonepay.com.br/api/public/v1';

function read_json_body(): array {
  $raw = file_get_contents('php://input');
  if ($raw === false || $raw === '') {
    return is_array($_POST) ? $_POST : [];
  }
  $data = json_decode($raw, true);
  if (is_array($data)) return $data;
  return is_array($_POST) ? $_POST : [];
}

function only_digits(string $value): string {
  return preg_replace('/\D+/', '', $value);
}

function normalize_cents($value): ?int {
  if ($value === null || $value === '') return null;
  if (is_int($value)) return $value;
  $v = trim((string)$value);
  if ($v === '') return null;
  $v = str_replace(['R$', '$', ' '], '', $v);
  if (preg_match('/[.,]/', $v)) {
    $v = str_replace('.', '', $v);
    $v = str_replace(',', '.', $v);
    if (!is_numeric($v)) return null;
    return (int)round(((float)$v) * 100);
  }
  if (!is_numeric($v)) return null;
  return (int)$v;
}

function extract_products_list($payload): array {
  if (is_array($payload)) {
    if (isset($payload['data']) && is_array($payload['data'])) return $payload['data'];
    if (isset($payload['products']) && is_array($payload['products'])) return $payload['products'];
  }
  return is_array($payload) ? $payload : [];
}

function extract_product_identity(array $product): array {
  $id = $product['id'] ?? $product['product_id'] ?? $product['code'] ?? null;
  $sku = $product['sku'] ?? $product['ref'] ?? $product['reference'] ?? null;
  $name = $product['name'] ?? $product['title'] ?? $product['description'] ?? null;
  $price = $product['price'] ?? $product['amount'] ?? $product['value'] ?? $product['price_cents'] ?? $product['amount_cents'] ?? null;
  return [
    'id' => $id !== null ? (string)$id : '',
    'sku' => $sku !== null ? (string)$sku : '',
    'name' => $name !== null ? (string)$name : '',
    'price_cents' => normalize_cents($price),
  ];
}

function extract_item_request(array $input, array $transaction): array {
  $item = [];
  if (isset($transaction['item']) && is_array($transaction['item'])) $item = $transaction['item'];
  if (empty($item) && isset($input['item']) && is_array($input['item'])) $item = $input['item'];
  if (empty($item) && isset($transaction['items']) && is_array($transaction['items']) && isset($transaction['items'][0]) && is_array($transaction['items'][0])) {
    $item = $transaction['items'][0];
  }
  if (empty($item) && isset($input['items']) && is_array($input['items']) && isset($input['items'][0]) && is_array($input['items'][0])) {
    $item = $input['items'][0];
  }
  $id = $item['id'] ?? $item['product_id'] ?? $input['product_id'] ?? $input['item_id'] ?? null;
  $sku = $item['sku'] ?? $item['ref'] ?? $input['product_sku'] ?? $input['sku'] ?? null;
  $name = $item['name'] ?? $item['title'] ?? $input['product_name'] ?? $input['name_item'] ?? null;
  return [
    'id' => $id !== null ? (string)$id : '',
    'sku' => $sku !== null ? (string)$sku : '',
    'name' => $name !== null ? (string)$name : '',
  ];
}

function http_request(string $method, string $url, array $headers = [], ?string $body = null): array {
  $ch = curl_init($url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
  if (!empty($headers)) {
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
  }
  if ($body !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  }
  $response = curl_exec($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $error = $response === false ? curl_error($ch) : null;
  curl_close($ch);
  return [$httpCode, $response, $error];
}

function json_response(int $status, array $payload): void {
  http_response_code($status);
  echo json_encode($payload);
  exit;
}

$apiToken = getenv('ZEROONEPAY_API_TOKEN');
if (!$apiToken) {
  json_response(500, ['error' => 'ZEROONEPAY_API_TOKEN nao configurado no servidor.']);
}

$baseUrl = getenv('ZEROONEPAY_BASE_URL') ?: ZEROONEPAY_DEFAULT_BASE_URL;
$baseUrl = rtrim($baseUrl, '/');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$resource = strtolower(trim((string)($_GET['resource'] ?? '')));

if ($method === 'GET') {
  if ($resource !== 'products' && $resource !== 'balance' && $resource !== 'transactions') {
    json_response(400, ['error' => 'Recurso invalido. Use ?resource=products, ?resource=balance ou ?resource=transactions.']);
  }
  $query = $_GET;
  unset($query['resource']);
  $query['api_token'] = $apiToken;

  $requestHeaders = [
    'Content-Type: application/json',
  ];

  if ($resource === 'transactions') {
    $id = $query['id'] ?? $query['transaction_id'] ?? $query['transaction_hash'] ?? null;
    if ($id) {
      unset($query['id'], $query['transaction_id'], $query['transaction_hash']);
      $url = $baseUrl . '/transactions/' . rawurlencode((string)$id) . '?' . http_build_query(['api_token' => $apiToken] + $query);
      [$status, $response, $error] = http_request('GET', $url, $requestHeaders);
      if ($error) {
        json_response(500, ['error' => 'Falha ao conectar no gateway.']);
      }
      if ($status !== 404) {
        http_response_code($status > 0 ? $status : 200);
        echo $response;
        exit;
      }
    }
    $url = $baseUrl . '/transactions?' . http_build_query($query);
    [$status, $response, $error] = http_request('GET', $url, $requestHeaders);
    if ($error) {
      json_response(500, ['error' => 'Falha ao conectar no gateway.']);
    }
    http_response_code($status > 0 ? $status : 200);
    echo $response;
    exit;
  }

  $url = $baseUrl . '/' . $resource . '?' . http_build_query($query);
  [$status, $response, $error] = http_request('GET', $url, $requestHeaders);
  if ($error) {
    json_response(500, ['error' => 'Falha ao conectar no gateway.']);
  }
  http_response_code($status > 0 ? $status : 200);
  echo $response;
  exit;
}

if ($method !== 'POST') {
  json_response(405, ['error' => 'Metodo nao permitido.']);
}

$input = read_json_body();

$transaction = isset($input['transaction']) && is_array($input['transaction']) ? $input['transaction'] : [];
$customer = isset($transaction['customer']) && is_array($transaction['customer'])
  ? $transaction['customer']
  : (isset($input['customer']) && is_array($input['customer']) ? $input['customer'] : []);

$name = trim((string)($customer['name'] ?? $input['name'] ?? ''));
$email = trim((string)($customer['email'] ?? $input['email'] ?? ''));
$documentRaw = trim((string)($customer['document'] ?? $input['document'] ?? ''));
$document = only_digits($documentRaw);
$phone = trim((string)($customer['phone'] ?? $input['phone'] ?? ''));

$amountInput = $transaction['amount'] ?? $transaction['value'] ?? $transaction['amount_cents'] ?? $input['amount'] ?? $input['value'] ?? $input['amount_cents'] ?? null;
$amountCents = normalize_cents($amountInput);

$paymentMethodInput = trim((string)($transaction['payment_method'] ?? $input['payment_method'] ?? $input['method'] ?? ''));
$paymentMethod = strtoupper($paymentMethodInput);
if ($paymentMethod === 'CARD') $paymentMethod = 'CREDIT_CARD';
if ($paymentMethod === 'CARTAO' || $paymentMethod === 'CARTAO_CREDITO') $paymentMethod = 'CREDIT_CARD';
if ($paymentMethod === 'PIX') $paymentMethod = 'PIX';

if ($name === '' || $email === '' || $document === '' || !$amountCents || $paymentMethod === '') {
  json_response(422, ['error' => 'Campos obrigatorios ausentes.']);
}

if (!isset($transaction['customer']) || !is_array($transaction['customer'])) {
  $transaction['customer'] = [];
}
$transaction['customer']['name'] = $name;
$transaction['customer']['email'] = $email;
$transaction['customer']['document'] = $document;
if ($phone !== '') {
  $transaction['customer']['phone'] = $phone;
}

if (!isset($transaction['amount']) && !isset($transaction['value']) && !isset($transaction['amount_cents'])) {
  $transaction['amount'] = $amountCents;
}
if (!isset($transaction['payment_method'])) {
  $transaction['payment_method'] = $paymentMethod;
}

$transaction['api_token'] = $apiToken;

$itemIdentity = extract_item_request($input, $transaction);
if ($itemIdentity['id'] !== '' || $itemIdentity['sku'] !== '' || $itemIdentity['name'] !== '') {
  $productsUrl = $baseUrl . '/products?' . http_build_query(['api_token' => $apiToken]);
  [$pStatus, $pResponse, $pError] = http_request('GET', $productsUrl, [
    'Content-Type: application/json',
  ]);
  if ($pError || $pStatus < 200 || $pStatus >= 300) {
    json_response(502, ['error' => 'Falha ao validar produto no gateway.']);
  }
  $productsPayload = json_decode($pResponse, true);
  $products = extract_products_list($productsPayload);
  $found = null;
  foreach ($products as $product) {
    if (!is_array($product)) continue;
    $identity = extract_product_identity($product);
    $matchId = $itemIdentity['id'] !== '' && $identity['id'] !== '' && $itemIdentity['id'] === $identity['id'];
    $matchSku = $itemIdentity['sku'] !== '' && $identity['sku'] !== '' && $itemIdentity['sku'] === $identity['sku'];
    $matchName = $itemIdentity['name'] !== '' && $identity['name'] !== '' && mb_strtolower($itemIdentity['name']) === mb_strtolower($identity['name']);
    if ($matchId || $matchSku || $matchName) {
      $found = $identity;
      break;
    }
  }
  if (!$found) {
    json_response(422, ['error' => 'Produto nao encontrado para validacao.']);
  }
  if ($found['price_cents'] !== null && $found['price_cents'] !== $amountCents) {
    json_response(422, ['error' => 'Valor do produto divergente do cadastrado.']);
  }
}

$url = $baseUrl . '/transactions';
[$status, $response, $error] = http_request('POST', $url, [
  'Content-Type: application/json',
], json_encode($transaction));

if ($error) {
  json_response(500, ['error' => 'Falha ao conectar no gateway.']);
}

http_response_code($status > 0 ? $status : 200);
echo $response;
