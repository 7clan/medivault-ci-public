# MediVault TLS Configuration Guide

This document covers TLS configuration for MediVault in production deployments
and for Windows local-server (Phase B) deployments.

---

## Table of Contents

1. [Production HTTPS Enforcement](#1-production-https-enforcement)
2. [Forwarding Header Trust](#2-forwarding-header-trust)
3. [Windows Local-Server TLS Configuration](#3-windows-local-server-tls-configuration)
4. [Android Certificate Trust](#4-android-certificate-trust)
5. [Certificate Generation Reference](#5-certificate-generation-reference)
6. [Security Notes](#6-security-notes)

---

## 1. Production HTTPS Enforcement

The Fastify server **enforces HTTPS at startup**. In production mode
(`NODE_ENV=production`), the server will **fail to start** unless one of
the following conditions is true:

| Condition | Environment Variable | Meaning |
|---|---|---|
| Direct TLS termination | `HTTPS=true` | The server itself terminates TLS (loads cert/key) |
| Upstream TLS expected | `NEXT_PUBLIC_BASE_URL=https://...` | TLS is handled by a reverse proxy upstream |
| Trusted local proxy | `TRUSTED_LOCAL_TLS_TERMINATION=true` | Behind a trusted local TLS-terminating proxy (e.g., Caddy on the same machine) |

### Implementation

This is implemented in
`mini-services/api-service/src/lib/https-enforcement.ts` via the
`enforceHttpsConfig()` function, which is called at the top of
`server.ts` before the Fastify instance is created.

```typescript
// Simplified logic from https-enforcement.ts
export function enforceHttpsConfig(): void {
  if (process.env.NODE_ENV !== 'production') return

  const hasExplicitHttps =
    process.env.HTTPS === 'true' ||
    process.env.NEXT_PUBLIC_BASE_URL?.startsWith('https')

  const isTrustedLocalTlsTermination =
    process.env.TRUSTED_LOCAL_TLS_TERMINATION === 'true'

  if (!hasExplicitHttps && !isTrustedLocalTlsTermination) {
    throw new Error(
      '[MediVault] FATAL: Running in production without explicit HTTPS configuration. ' +
      'Set HTTPS=true or NEXT_PUBLIC_BASE_URL=https://... in production, ' +
      'or set TRUSTED_LOCAL_TLS_TERMINATION=true if behind a trusted local TLS-terminating proxy.',
    )
  }
}
```

### Startup Behavior

- If enforcement fails, the error is caught in `server.ts` and the process
  exits with code 1 — the server never binds a port.
- In development (`NODE_ENV` is not `production`), enforcement is skipped
  entirely.

---

## 2. Forwarding Header Trust

The server does **NOT** trust arbitrary `X-Forwarded-*` headers in
production. This prevents header spoofing attacks.

### Trust Proxy Logic

Implemented in `mini-services/api-service/src/server.ts` via
`getTrustProxy()`:

| Environment | `trustProxy` Value | Effect |
|---|---|---|
| Development (not production) | `'127.0.0.1'` | Trust headers from localhost only (for local dev proxies) |
| `TRUSTED_LOCAL_TLS_TERMINATION=true` | `'127.0.0.1'` | Trust headers from localhost only (local TLS proxy like Caddy) |
| Production (default) | `false` | **No** proxy headers are trusted |

### Security Implications

- `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` are only
  trusted when `trustProxy` is set.
- In production with the default `false`, `request.ip` reflects the direct
  TCP peer, and `request.protocol` is always the actual connection protocol.
- When behind a reverse proxy, set `TRUSTED_LOCAL_TLS_TERMINATION=true` only
  if the proxy runs on the same machine (127.0.0.1) and cannot be reached
  by untrusted clients.

---

## 3. Windows Local-Server TLS Configuration

For the Windows installer (Phase B), the local server needs its own TLS
certificate. The following steps configure a self-signed certificate for
local-only access.

### 3a. Generate a Self-Signed Certificate

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout medivault.key \
  -out medivault.crt \
  -days 3650 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

This generates:

- `medivault.key` — RSA 2048-bit private key (unencrypted, `-nodes`)
- `medivault.crt` — Self-signed X.509 certificate valid for 10 years
- SAN includes both `DNS:localhost` and `IP:127.0.0.1`

### 3b. Install Certificate into Windows Trust Store

The self-signed certificate must be trusted by the local machine. Import
it into the **Trusted Root Certification Authorities** store:

**Option 1 — PowerShell (recommended for installers):**

```powershell
Import-Certificate -FilePath "C:\MediVault\medivault.crt" `
  -CertStoreLocation "Cert:\LocalMachine\Root"
```

**Option 2 — certutil:**

```cmd
certutil -addstore -f "Root" "C:\MediVault\medivault.crt"
```

**Option 3 — Windows Certificate Manager (manual):**

1. Press `Win + R`, type `certlm.msc`, press Enter
2. Navigate to **Trusted Root Certification Authorities** > **Certificates**
3. Right-click > **All Tasks** > **Import**
4. Select `medivault.crt` and complete the wizard

### 3c. Server Configuration

Set the following environment variables for the MediVault API service:

```env
NODE_ENV=production
HTTPS=true
TLS_CERT_PATH=C:\MediVault\medivault.crt
TLS_KEY_PATH=C:\MediVault\medivault.key
MEDIVAULT_MASTER_KEY=<generate-a-strong-key>
```

The Fastify server should be configured to read `TLS_CERT_PATH` and
`TLS_KEY_PATH` when `HTTPS=true`, then pass them to Node.js `tls`
for direct TLS termination.

### 3d. Server Identity Verification

The certificate's Common Name (CN) **must match** the hostname that
clients use to connect:

| Deployment | CN Value | SAN | Client Connects To |
|---|---|---|---|
| Local-only (same machine) | `localhost` | `DNS:localhost, IP:127.0.0.1` | `https://localhost:3001` |
| Local network (clinic LAN) | `clinic-server` | `DNS:clinic-server, IP:192.168.x.x` | `https://clinic-server:3001` |

> **Important:** If the Android app or browser connects to an IP address
> or hostname not covered by the certificate SAN, TLS verification will
> fail.

---

## 4. Android Certificate Trust

The Android mobile app will not trust a self-signed certificate by default.
You must explicitly configure trust. Two approaches are available:

### 4a. Network Security Config (Recommended)

1. **Export the certificate in DER format:**

   ```bash
   openssl x509 -in medivault.crt -outform DER -out medivault.der
   ```

2. **Place the DER file** in the Android app resources:

   ```
   app/src/main/res/raw/medivault.crt
   ```

3. **Create a network security config** at
   `app/src/main/res/xml/network_security_config.xml`:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <network-security-config>
     <domain-config>
       <domain includeSubdomains="true">localhost</domain>
       <pin-set>
         <pin digest="SHA-256">BASE64_ENCODED_CERTIFICATE_SHA256</pin>
         <pin digest="SHA-256">BASE64_ENCODED_CERTIFICATE_PUBLIC_KEY_SHA256</pin>
       </pin-set>
       <trust-anchors>
         <certificates src="@raw/medivault" />
       </trust-anchors>
     </domain-config>
   </network-security-config>
   ```

4. **Reference the config** in `AndroidManifest.xml`:

   ```xml
   <application
       android:networkSecurityConfig="@xml/network_security_config"
       ... >
   ```

   To get the SHA-256 pin values:

   ```bash
   # Certificate fingerprint
   openssl x509 -in medivault.crt -pubkey -noout |
     openssl pkey -pubin -outform DER |
     openssl dgst -sha256 -binary |
     openssl enc -base64

   # Public key fingerprint
   openssl x509 -in medivault.crt -pubkey -noout |
     openssl pkey -pubin -outform DER |
     openssl dgst -sha256 -binary |
     openssl enc -base64
   ```

### 4b. BKS Keystore with OkHttp (Alternative)

1. **Convert the certificate to BKS keystore:**

   ```bash
   # Requires Bouncy Castle provider JAR
   keytool -importcert \
     -trustcacerts \
     -alias medivault \
     -file medivault.crt \
     -keystore medivault.bks \
     -storetype BKS \
     -providerclass org.bouncycastle.jce.provider.BouncyCastleProvider \
     -providerpath bcprov-jdk18on-1.78.jar \
     -storepass changeit
   ```

2. **Place the keystore** in `app/src/main/res/raw/medivault.bks`

3. **Configure OkHttp** to use the custom trust manager:

   ```kotlin
   val keyStore = KeyStore.getInstance("BKS")
   val inputStream = context.resources.openRawResource(R.raw.medivault)
   inputStream.use { keyStore.load(it, "changeit".toCharArray()) }

   val trustManagerFactory = TrustManagerFactory.getInstance(
       TrustManagerFactory.getDefaultAlgorithm()
   )
   trustManagerFactory.init(keyStore)

   val sslContext = SSLContext.getInstance("TLS")
   sslContext.init(null, trustManagerFactory.trustManagers, null)

   val client = OkHttpClient.Builder()
       .sslSocketFactory(sslContext.socketFactory, trustManagerFactory.trustManagers[0] as X509TrustManager)
       .build()
   ```

> **Recommendation:** Use approach 4a (Network Security Config) — it is
> the modern Android-standard method and does not require Bouncy Castle.

---

## 5. Certificate Generation Reference

### RSA 2048-bit Certificate

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout medivault.key \
  -out medivault.crt \
  -days 3650 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

### ECDSA P-256 Certificate

```bash
openssl ecparam -genkey -name prime256v1 -noout -out medivault-ec.key

openssl req -x509 -new \
  -key medivault-ec.key \
  -out medivault-ec.crt \
  -days 3650 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

### For LAN Deployment (custom hostname/IP)

```bash
openssl req -x509 -newkey rsa:2048 \
  -keyout medivault.key \
  -out medivault.crt \
  -days 3650 \
  -nodes \
  -subj "/CN=clinic-server" \
  -addext "subjectAltName=DNS:clinic-server,IP:192.168.1.100"
```

### Verify a Generated Certificate

```bash
openssl x509 -in medivault.crt -text -noout | head -20
openssl x509 -in medivault.crt -noout -subject -issuer -dates -ext subjectAltName
```

---

## 6. Security Notes

### Self-Signed Certificates

- Self-signed certificates are **acceptable** for local-only or
  single-clinic deployments where all clients are controlled.
- They are **not acceptable** for multi-clinic or cloud deployments
  where clients connect over the public internet.

### Production (Cloud / Multi-Clinic) Deployments

- Use **Let's Encrypt** (free, automated) or a **commercial CA**
  (e.g., DigiCert, Sectigo) for publicly trusted certificates.
- Place the server behind a TLS-terminating reverse proxy (Caddy,
  nginx, Cloudflare).
- Set `NEXT_PUBLIC_BASE_URL=https://your-domain.com` to satisfy
  HTTPS enforcement.

### Master Key Requirement

- The `MEDIVAULT_MASTER_KEY` environment variable **must be set** in
  production. This key is used for cryptographic operations (encryption,
  token signing).
- Generate a strong key: `openssl rand -base64 48`

### Secure Cookie Flag

- Cookies use the `Secure` flag when TLS is active, controlled by
  `shouldUseSecureCookies()` in `https-enforcement.ts`.
- The flag is enabled when `NODE_ENV=production` **or** when
  `TRUSTED_LOCAL_TLS_TERMINATION=true`.
- All auth cookies (`mvlt_session`, `mvlt_refresh`, `mvlt_csrf`) use
  `Secure` + `HttpOnly` + `SameSite=Lax`.

### Related Documentation

- [HTTPS and Trust Model for Clinic Server Deployment](./https-trust-model.md)
- [Migration Compatibility Guide](./migration-compatibility.md)
- [Cryptographic Design](./m3-crypto-design.md)
