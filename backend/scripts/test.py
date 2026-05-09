import requests

res = requests.post(
    "http://localhost:11434/api/generate",
    json={
        "model": "qwen2.5:7b-instruct-q4_K_M",
        "prompt": "Say hello",
        "stream": False
    }
)

print(res.status_code)
print(res.text)
