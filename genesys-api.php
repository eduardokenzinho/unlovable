<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'Método não permitido.']);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'Payload inválido.']);
  exit;
}

$name = trim((string)($input['name'] ?? ''));
$email = trim((string)($input['email'] ?? ''));
$phone = trim((string)($input['phone'] ?? ''));
$documentTypeInput = strtoupper(trim((string)($input['document_type'] ?? '')));
$documentRaw = trim((string)($input['document'] ?? ''));
$documentDigits = preg_replace('/\D+/', '', $documentRaw);
$documentType = in_array($documentTypeInput, ['CPF', 'CNPJ'], true)
  ? $documentTypeInput
  : (strlen($documentDigits) === 14 ? 'CNPJ' : 'CPF');
$document = $documentDigits;
$planKey = trim((string)($input['plan'] ?? 'mensal'));
$academySelected = (bool)($input['academy'] ?? false);
$externalIdInput = trim((string)($input['external_id'] ?? ''));

if ($name === '' || $email === '' || $phone === '' || $documentType === '' || $document === '') {
  http_response_code(422);
  echo json_encode(['error' => 'Campos obrigatórios ausentes.']);
  exit;
}

$plans = [
  'mensal' => ['label' => 'Plano Mensal', 'price' => 57.00, 'title' => 'Assinatura Mensal'],
  'trimestral' => ['label' => 'Plano Trimestral', 'price' => 167.00, 'title' => 'Assinatura Trimestral'],
];

if (!isset($plans[$planKey])) {
  http_response_code(422);
  echo json_encode(['error' => 'Plano inválido.']);
  exit;
}

$apiSecret = getenv('GENESYS_API_SECRET');
if (!$apiSecret) {
  http_response_code(500);
  echo json_encode(['error' => 'GENESYS_API_SECRET não configurado no servidor.']);
  exit;
}

$baseUrl = getenv('GENESYS_BASE_URL') ?: 'https://api.genesys.finance';
$webhookUrlRaw = getenv('GENESYS_WEBHOOK_URL') ?: '';
$webhookUrl = filter_var($webhookUrlRaw, FILTER_VALIDATE_URL) ? $webhookUrlRaw : '';

$plan = $plans[$planKey];
$academy = [
  'id' => 'academy',
  'label' => 'Unlovable Academy',
  'price' => 37.00,
  'title' => 'Unlovable Academy',
];

$totalAmount = $plan['price'] + ($academySelected ? $academy['price'] : 0);
$externalId = $externalIdInput !== '' ? $externalIdInput : uniqid('ulv_', true);

$transaction = [
  'external_id' => $externalId,
  'total_amount' => $totalAmount,
  'payment_method' => 'PIX',
  'webhook_url' => $webhookUrl ?: null,
  'items' => [
    [
      'id' => $planKey,
      'title' => $plan['title'],
      'description' => $plan['label'],
      'price' => $plan['price'],
      'quantity' => 1,
      'is_physical' => false,
    ],
  ],
  'ip' => $input['ip'] ?? ($_SERVER['REMOTE_ADDR'] ?? null),
  'customer' => [
    'name' => $name,
    'email' => $email,
    'phone' => $phone,
    'document_type' => $documentType,
    'document' => $document,
  ],
];

if ($academySelected) {
  $transaction['items'][] = [
    'id' => $academy['id'],
    'title' => $academy['title'],
    'description' => $academy['label'],
    'price' => $academy['price'],
    'quantity' => 1,
    'is_physical' => false,
  ];
}

if (empty($transaction['external_id'])) {
  unset($transaction['external_id']);
}
if (empty($transaction['webhook_url'])) {
  unset($transaction['webhook_url']);
}
if (empty($transaction['ip'])) {
  unset($transaction['ip']);
}

$ch = curl_init(rtrim($baseUrl, '/') . '/v1/transactions');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  'Content-Type: application/json',
  'api-secret: ' . $apiSecret,
]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($transaction));

$response = curl_exec($ch);
$httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);

if ($response === false) {
  http_response_code(500);
  echo json_encode(['error' => 'Falha ao conectar no gateway.']);
  curl_close($ch);
  exit;
}

curl_close($ch);
http_response_code($httpCode > 0 ? $httpCode : 200);
echo $response;
