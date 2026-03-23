<?php
// --- CONFIGURACOES ---
$pixel_id = '1311060920880371'; 
$access_token = 'EAAMS86t3MiABROQMK8vweQl5OAzZB1BzH5zpw0QtSa4OcFDH1ZAVz6B4RdFFJZAmogl81AEjlZBkWmPVGUmTuVNjb3Dzt0EtByZBEmLTMvYVydHNwyZBg0jfSVgQSffdZCkZcud3vRw1RymuaPNkFMT6iUCzKebkKPcdwKgCGz8rjVleD029RU3fy91898zSOgZDZD';
$test_event_code = 'TEST16797'; // test ativo (Ayron)

$user_data = [
    'client_ip_address' => $_SERVER['REMOTE_ADDR'],
    'client_user_agent' => $_SERVER['HTTP_USER_AGENT'],
    'fbc' => $_COOKIE['_fbc'] ?? null,
    'fbp' => $_COOKIE['_fbp'] ?? null
];

$event = [
    'event_name' => 'PageView',
    'event_time' => time(),
    'action_source' => 'website',
    'event_source_url' => 'https://' . $_SERVER['HTTP_HOST'] . $_SERVER['REQUEST_URI'],
    'user_data' => array_filter($user_data)
];

$data = [
    'data' => [$event],
    'test_event_code' => $test_event_code 
];

$url = "https://graph.facebook.com/v18.0/$pixel_id/events?access_token=$access_token";

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

$response = curl_exec($ch);
curl_close($ch);

echo $response;

// Como incluir na landing page:
// 1) Via PHP (servidor): no topo da pagina, use include 'fb-api.php'; ou require 'fb-api.php';
// 2) Via JavaScript (cliente): crie um endpoint PHP que execute este arquivo e chame-o com fetch('fb-api.php')
?>

