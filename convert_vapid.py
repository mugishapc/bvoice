from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
import base64

# Load private key from PEM
with open("private_key.pem", "rb") as f:
    private_key = serialization.load_pem_private_key(f.read(), password=None)

# Derive public key
public_key = private_key.public_key()

# Convert private key number to Base64 URL-safe
private_num = private_key.private_numbers().private_value
private_key_b64 = base64.urlsafe_b64encode(
    private_num.to_bytes(32, "big")
).decode("utf-8").rstrip("=")

# Convert public key (x and y) to Base64 URL-safe
public_num = public_key.public_numbers()
public_bytes = public_num.x.to_bytes(32, "big") + public_num.y.to_bytes(32, "big")
public_key_b64 = base64.urlsafe_b64encode(public_bytes).decode("utf-8").rstrip("=")

print("VAPID_PRIVATE_KEY =", private_key_b64)
print("VAPID_PUBLIC_KEY =", public_key_b64)
