#!/usr/bin/env python3
"""
Ollama diagnostic script - checks if Ollama is properly configured and running.
Usage: python check_ollama.py
"""

import os
import sys
import requests
from urllib.parse import urlparse

def check_ollama_connection():
    """Check if Ollama is running and responding."""
    ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
    ollama_model = os.getenv("OLLAMA_MODEL", "deepseek-r1:7b")
    
    print(f"Ollama Diagnostics")
    print(f"{'=' * 60}")
    print(f"Base URL: {ollama_url}")
    print(f"Model: {ollama_model}")
    print(f"{'=' * 60}\n")
    
    # Test 1: Connection
    print("Test 1: Checking connection...")
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=5)
        print("  [OK] Connected to Ollama")
    except requests.exceptions.ConnectionError:
        print("  [NO] Cannot connect to Ollama")
        print(f"     Make sure Ollama is running: ollama serve")
        return False
    except requests.exceptions.Timeout:
        print("  [NO] Connection timeout - Ollama not responding")
        return False
    except Exception as e:
        print(f"  [NO] Connection error: {e}")
        return False
    
    # Test 2: Get available models
    print("\nTest 2: Checking available models...")
    try:
        response = requests.get(f"{ollama_url}/api/tags", timeout=5)
        response.raise_for_status()
        models = response.json().get("models", [])
        
        if not models:
            print("  [WARN] No models found in Ollama")
            print(f"     Pull a model: ollama pull {ollama_model}")
            return False
        
        print(f"  [OK] Found {len(models)} model(s):")
        for model in models:
            model_name = model.get("name", "unknown")
            model_size = model.get("size", 0)
            size_gb = model_size / (1024**3)
            print(f"     - {model_name} ({size_gb:.2f} GB)")
    except Exception as e:
        print(f"  [NO] Error retrieving models: {e}")
        return False
    
    # Test 3: Check for configured model
    print(f"\nTest 3: Checking for model '{ollama_model}'...")
    try:
        model_base = ollama_model.split(":")[0]
        found = False
        for model in models:
            if model_base in model.get("name", ""):
                found = True
                print(f"  [OK] Model found: {model.get('name')}")
                break
        
        if not found:
            print(f"  [NO] Model '{ollama_model}' not found")
            print(f"     Pull it with: ollama pull {ollama_model}")
            return False
    except Exception as e:
        print(f"  [NO] Error checking model: {e}")
        return False
    
    # Test 4: Test generation
    print(f"\nTest 4: Testing generation with '{ollama_model}'...")
    try:
        response = requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": ollama_model,
                "prompt": "Answer briefly: What is 2+2?",
                "stream": False,
            },
            timeout=120,
        )
        
        if response.status_code == 404:
            response_lower = (response.text or "").lower()
            if "model" in response_lower and "not found" in response_lower:
                print(f"  [NO] Model '{ollama_model}' was not found by Ollama")
                print("     Use an installed tag from `ollama list` (example: llama2:7b)")
            else:
                print("  [NO] API endpoint /api/generate not found")
                print("     Check Ollama version: ollama -v")
            return False
        
        response.raise_for_status()
        result = response.json()
        generated = result.get("response", "").strip()
        
        if generated:
            print(f"  [OK] Generation successful!")
            print(f"     Response: {generated[:100]}...")
        else:
            print("  [WARN] Generation returned empty response")
            return False
    except requests.exceptions.Timeout:
        print("  [NO] Generation timeout - model may be overloaded")
        print("     Try with a smaller model or wait for resources to free up")
        return False
    except Exception as e:
        print(f"  [NO] Generation failed: {e}")
        return False
    
    print(f"\n{'=' * 60}")
    print("[OK] All checks passed! Ollama is properly configured.")
    print(f"{'=' * 60}\n")
    return True


if __name__ == "__main__":
    # Load environment from .env if it exists
    try:
        from dotenv import load_dotenv
        load_dotenv("backend/.env")
    except ImportError:
        pass
    
    success = check_ollama_connection()
    sys.exit(0 if success else 1)
