import requests
import json

print('=' * 60)
print('Testing API Endpoints')
print('=' * 60)

# Test 1: GET /api/health
print('\n=== TEST 1: GET /api/health ===')
try:
    response = requests.get('http://localhost:8000/api/health')
    print(f'HTTP Status: {response.status_code}')
    print(f'Response Body: {json.dumps(response.json(), indent=2)}')
except Exception as e:
    print(f'Error: {e}')

# Test 2: GET /api/v2/health
print('\n=== TEST 2: GET /api/v2/health ===')
try:
    response = requests.get('http://localhost:8000/api/v2/health')
    print(f'HTTP Status: {response.status_code}')
    print(f'Response Body: {json.dumps(response.json(), indent=2)}')
except Exception as e:
    print(f'Error: {e}')

# Test 3: GET /api/metrics
print('\n=== TEST 3: GET /api/metrics ===')
try:
    response = requests.get('http://localhost:8000/api/metrics')
    print(f'HTTP Status: {response.status_code}')
    data = response.json()
    print(f'Response Body: {json.dumps(data, indent=2)}')
    required_keys = ['chat_requests_total', 'chat_errors_total', 'avg_latency_ms']
    print(f'Required Keys Check:')
    for key in required_keys:
        status = 'OK' if key in data else 'MISSING'
        print(f'  {status}: {key}')
except Exception as e:
    print(f'Error: {e}')

# Test 4: POST /api/chat
print('\n=== TEST 4: POST /api/chat ===')
try:
    payload = {
        'message': 'test',
        'cluster_id': 'test-cluster',
        'task_type': 'rca'
    }
    response = requests.post('http://localhost:8000/api/chat', json=payload)
    print(f'HTTP Status: {response.status_code}')
    data = response.json()
    print(f'Response Body: {json.dumps(data, indent=2)}')
    if 'mode' in data:
        mode_val = data['mode']
        print(f'Mode field value: {mode_val}')
except Exception as e:
    print(f'Error: {type(e).__name__}: {e}')

# Test 5: GET /api/models
print('\n=== TEST 5: GET /api/models ===')
try:
    response = requests.get('http://localhost:8000/api/models')
    print(f'HTTP Status: {response.status_code}')
    data = response.json()
    print(f'Response Body: {json.dumps(data, indent=2)}')
    if 'task_models' in data:
        required_task_keys = ['rca', 'hypothesis', 'citations', 'challenge', 'fallback']
        print(f'Task Models Keys Check:')
        for key in required_task_keys:
            status = 'OK' if key in data['task_models'] else 'MISSING'
            print(f'  {status}: {key}')
except Exception as e:
    print(f'Error: {e}')
