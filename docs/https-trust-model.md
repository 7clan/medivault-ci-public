# HTTPS and Trust Model for Clinic Server Deployment

## Production Requirements
- All cookies MUST use the Secure flag (enforced by NODE_ENV check)
- Server must be behind a TLS-terminating reverse proxy (nginx/Caddy)
- Set `HTTPS=true` or `NEXT_PUBLIC_BASE_URL=https://clinic.example.com`

## Local Certificate and Pairing Trust Model
- The clinic server runs on the local network behind a TLS proxy
- Device pairing uses ECDSA-P256 challenge-response; the public key is stored server-side
- The Android client stores the private key in Android Keystore (hardware-backed)
- Pairing codes are short-lived (10 min) and single-use
- The approving browser never receives the new device's refresh token

## Proxy Configuration
- The proxy MUST set `X-Forwarded-For` for client IP logging
- Do NOT trust `X-Forwarded-Proto` for security decisions (only for logging)
- Set `ALLOWED_ORIGINS=https://clinic.example.com` in environment
