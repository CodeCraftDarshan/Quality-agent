#!/usr/bin/env python3
"""
Discover available Ollama endpoints for your version.
Run this to find which generation endpoint your Ollama supports.
"""

import os
import requests
import json

OLLAMA_BASE_URL = "http://localhost:11434"
MODEL = os.getenv("OLLAMA_MODEL", "llama2:7b")

def test_endpoint(endpoint, method="POST"):
    """Test if an endpoint exists and responds."""
    url = f"{OLLAMA_BASE_URL}{endpoint}"
    
    if method == "GET":
        try:
            response = requests.get(url, timeout=5)
            return response.status_code, response.text[:200]
        except Exception as e:
            return "ERROR", str(e)
    
    # POST with different payload formats
    payloads = [
        # Standard generate format
        {
            "model": MODEL,
            "prompt": "What is 2+2?",
            "stream": False,
        },
        # Chat format
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": "What is 2+2?"}],
            "stream": False,
        },
        # OpenAI completions format
        {
            "model": MODEL,
            "prompt": "What is 2+2?",
            "max_tokens": 10,
        },
        # Generic prompt
        {
            "prompt": "What is 2+2?",
        },
    ]
    
    for i, payload in enumerate(payloads):
        try:
            response = requests.post(url, json=payload, timeout=5)
            status = response.status_code
            if status == 200:
                result = response.json()
                return status, json.dumps(result)[:200]
            else:
                return status, response.text[:200]
        except Exception as e:
            if i == len(payloads) - 1:
                return "ERROR", str(e)

print("Ollama Endpoint Discovery")
print(f"{'=' * 60}")
print(f"Testing endpoints for: {OLLAMA_BASE_URL}")
print(f"Model: {MODEL}")
print(f"{'=' * 60}\n")

# Test endpoints
endpoints_to_test = [
    # Common generation endpoints
    "/api/generate",
    "/generate",
    "/api/chat",
    "/chat",
    "/v1/completions",
    "/completions",
    
    # Less common
    "/api/create",
    "/create",
    "/api/prompt",
    "/prompt",
    "/api/completion",
    "/completion",
    
    # Info endpoints
    ("/api/version", "GET"),
    ("/api/tags", "GET"),
    ("/version", "GET"),
    ("/models", "GET"),
]

print("Testing endpoints:\n")
working_endpoints = []

for endpoint_info in endpoints_to_test:
    if isinstance(endpoint_info, tuple):
        endpoint, method = endpoint_info
    else:
        endpoint = endpoint_info
        method = "POST"
    
    status, response = test_endpoint(endpoint, method)
    
    response_lower = str(response).lower()
    # Check if it worked
    if status == 200:
        print(f"[OK] {endpoint:30} [{method:4}] - WORKING!")
        if method == "POST":
            working_endpoints.append(endpoint)
        print(f"   Response: {response}\n")
    elif status == 404:
        if "model" in response_lower and "not found" in response_lower:
            print(f"[WARN] {endpoint:30} [{method:4}] - Endpoint exists but model '{MODEL}' was not found")
            print(f"   Response: {response}")
        else:
            print(f"[NO] {endpoint:30} [{method:4}] - Not found (404)")
    elif status == 405:
        print(f"[WARN] {endpoint:30} [{method:4}] - Method not allowed (405)")
    else:
        print(f"[WARN] {endpoint:30} [{method:4}] - Status: {status}")
    
    print()

print(f"{'=' * 60}")
if working_endpoints:
    print(f"\n[OK] Found working generation endpoint(s):\n")
    for ep in working_endpoints:
        print(f"   {ep}")
        print(f"   Set this in your .env file:")
        print(f"   OLLAMA_ENDPOINT={OLLAMA_BASE_URL}{ep}\n")
else:
    print("\n[NO] No working generation endpoints found!")
    print("\nNote: Some endpoints may return 404 even if Ollama is running.")
    print("This version (0.18.2) may have limited API support.")
    print("\nRecommended solutions:")
    print("1. Upgrade Ollama to the latest version from https://ollama.ai")
    print("2. Or test these endpoints manually with curl:")
    print("   curl -X POST http://localhost:11434/api/generate \\")
    print("     -H 'Content-Type: application/json' \\")
    print("     -d '{\"model\":\"llama2\",\"prompt\":\"hello\",\"stream\":false}'")

print(f"{'=' * 60}\n")
