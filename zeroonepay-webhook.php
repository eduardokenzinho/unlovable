<?php
header('Content-Type: application/json; charset=utf-8');
header('X-ZeroOnePay-Webhook: ok');

if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'POST') !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'Metodo nao permitido.']);
  exit;
}

$raw = file_get_contents('php://input');
$payload = json_decode($raw ?: '', true);
if (!is_array($payload)) {
  http_response_code(400);
  echo json_encode(['error' => 'Payload invalido.']);
  exit;
}

$transactionHash = trim((string)($payload['transaction_hash'] ?? ''));
$status = trim((string)($payload['status'] ?? ''));
$amount = $payload['amount'] ?? null;
$paymentMethod = $payload['payment_method'] ?? null;
$paidAt = $payload['paid_at'] ?? null;

if ($transactionHash === '' || $status === '') {
  http_response_code(422);
  echo json_encode(['error' => 'Campos obrigatorios ausentes.']);
  exit;
}

$logDir = __DIR__ . DIRECTORY_SEPARATOR . 'storage';
$logFile = $logDir . DIRECTORY_SEPARATOR . 'zeroonepay-webhook.log';
$logged = false;
if (!is_dir($logDir)) {
  @mkdir($logDir, 0755, true);
}
if (is_dir($logDir)) {
  $entry = [
    'received_at' => gmdate('c'),
    'ip' => $_SERVER['REMOTE_ADDR'] ?? null,
    'transaction_hash' => $transactionHash,
    'status' => $status,
    'amount' => $amount,
    'payment_method' => $paymentMethod,
    'paid_at' => $paidAt,
    'payload' => $payload,
  ];
  $line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL;
  $logged = @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX) !== false;
}

http_response_code(200);
echo json_encode([
  'received' => true,
  'logged' => $logged,
  'transaction_hash' => $transactionHash,
  'status' => $status,
  'amount' => $amount,
  'payment_method' => $paymentMethod,
  'paid_at' => $paidAt,
]);
