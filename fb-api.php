<?php
// --- CONFIGURACOES ---
$pixel_id = '1311060920880371';
$access_token = 'EAAMS86t3MiABROQMK8vweQl5OAzZB1BzH5zpw0QtSa4OcFDH1ZAVz6B4RdFFJZAmogl81AEjlZBkWmPVGUmTuVNjb3Dzt0EtByZBEmLTMvYVydHNwyZBg0jfSVgQSffdZCkZcud3vRw1RymuaPNkFMT6iUCzKebkKPcdwKgCGz8rjVleD029RU3fy91898zSOgZDZD';
$default_test_event_code = 'TEST16797'; // test ativo (Ayron)

header('Content-Type: application/json; charset=utf-8');

function normalize_and_hash($value) {
    if ($value === null) {
        return null;
    }
    $value = trim(mb_strtolower($value, 'UTF-8'));
    if ($value === '') {
        return null;
    }
    return hash('sha256', $value);
}

function normalize_phone($value) {
    if ($value === null) {
        return null;
    }
    $value = preg_replace('/\D+/', '', $value);
    return $value !== '' ? $value : null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function send_capi_event($pixel_id, $access_token, $default_test_event_code, $event, $test_event_code = null) {
    $data = [
        'data' => [$event],
        'test_event_code' => $test_event_code ?? $default_test_event_code,
    ];

    $url = "https://graph.facebook.com/v18.0/$pixel_id/events?access_token=$access_token";

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

    $response = curl_exec($ch);
    $curl_error = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        return ['ok' => false, 'error' => $curl_error ?: 'curl_error'];
    }

    $decoded = json_decode($response, true);
    return $decoded !== null ? $decoded : ['ok' => true, 'raw' => $response];
}

if ($method !== 'POST') {
    if (isset($_GET['test']) && $_GET['test'] === '1') {
        $event = [
            'event_name' => 'TestEvent',
            'event_time' => time(),
            'action_source' => 'website',
            'event_source_url' => 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'],
            'user_data' => array_filter([
                'client_ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
                'client_user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
                'fbc' => $_COOKIE['_fbc'] ?? null,
                'fbp' => $_COOKIE['_fbp'] ?? null
            ]),
        ];

        echo json_encode(send_capi_event($pixel_id, $access_token, $default_test_event_code, $event));
        exit;
    }

    echo json_encode(['ok' => true, 'message' => 'fb-api ready', 'test' => 'append ?test=1']);
    exit;
}

$raw_body = file_get_contents('php://input');
$payload = [];
if ($raw_body) {
    $decoded = json_decode($raw_body, true);
    if (is_array($decoded)) {
        $payload = $decoded;
    }
}

$event_name = $payload['event_name'] ?? 'PageView';
$event_time = isset($payload['event_time']) ? (int)$payload['event_time'] : time();
$action_source = $payload['action_source'] ?? 'website';
$event_source_url = $payload['event_source_url'] ?? ('https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI']);
$custom_data = isset($payload['custom_data']) && is_array($payload['custom_data']) ? $payload['custom_data'] : [];

$user_data_input = isset($payload['user_data']) && is_array($payload['user_data']) ? $payload['user_data'] : [];

$user_data = [
    'client_ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
    'client_user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
    'fbc' => $_COOKIE['_fbc'] ?? null,
    'fbp' => $_COOKIE['_fbp'] ?? null,
    'em' => normalize_and_hash($user_data_input['em'] ?? null),
    'ph' => normalize_and_hash(normalize_phone($user_data_input['ph'] ?? null)),
    'fn' => normalize_and_hash($user_data_input['fn'] ?? null),
    'ln' => normalize_and_hash($user_data_input['ln'] ?? null),
    'external_id' => normalize_and_hash($user_data_input['external_id'] ?? null),
];

$event = [
    'event_name' => $event_name,
    'event_time' => $event_time,
    'action_source' => $action_source,
    'event_source_url' => $event_source_url,
    'user_data' => array_filter($user_data),
];

if (!empty($custom_data)) {
    $event['custom_data'] = $custom_data;
}

echo json_encode(
    send_capi_event(
        $pixel_id,
        $access_token,
        $default_test_event_code,
        $event,
        $payload['test_event_code'] ?? null
    )
);
?>

