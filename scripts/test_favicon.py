import sys
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from starlette.testclient import TestClient
from app.main import app

client = TestClient(app)

# Test 1: GET /favicon.ico
r1 = client.get("/favicon.ico")
print("1. GET /favicon.ico -> Status:", r1.status_code, "Content-Type:", r1.headers.get("content-type"), "Length:", len(r1.content))
assert r1.status_code == 200
assert r1.headers.get("content-type") == "image/x-icon"
assert len(r1.content) > 0

# Test 2: GET /assets/favicon-32x32.png
r2 = client.get("/assets/favicon-32x32.png")
print("2. GET /assets/favicon-32x32.png -> Status:", r2.status_code, "Content-Type:", r2.headers.get("content-type"), "Length:", len(r2.content))
assert r2.status_code == 200
assert "image/png" in r2.headers.get("content-type", "")
assert len(r2.content) > 0

# Test 3: GET /assets/apple-touch-icon.png
r3 = client.get("/assets/apple-touch-icon.png")
print("3. GET /assets/apple-touch-icon.png -> Status:", r3.status_code, "Content-Type:", r3.headers.get("content-type"))
assert r3.status_code == 200

# Test 4: GET /site.webmanifest
r4 = client.get("/site.webmanifest")
print("4. GET /site.webmanifest -> Status:", r4.status_code, "Content:", r4.text[:60].strip())
assert r4.status_code == 200

# Test 5: GET / (index.html) has favicon link
r5 = client.get("/")
print("5. GET / -> Status:", r5.status_code, "Favicon in HTML:", "favicon.ico" in r5.text)
assert r5.status_code == 200
assert "favicon.ico" in r5.text

print("\nAll favicon and asset checks passed successfully!")
