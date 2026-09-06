# MediVault — Crypto Design Document (MVLT v3)

> **Version:** MVLT v3 (format version 3)
> **Last updated:** matches source at `packages/crypto/src/`

---

## 1. Final Binary Format Specification (MVLT v3)

Each encrypted file on disk uses the MVLT v3 binary format. All multi-byte integers
are **BIG-ENDIAN**.

### 1.1 Header Layout

```
Offset    Size     Field
-------   -------  -----
0         4B       Magic: "MVLT" (0x4D564C54)
4         2B       Format version (uint16 BE): 3
6         1B       Algorithm ID: 0x01 = AES-256-GCM
7         4B       Header length (uint32 BE): total header bytes including auth tag
11        1B       Key ID length K (uint8)
12        KB       Key ID (UTF-8, non-secret version identifier, e.g. "key-v1")
12+K      32B      Object salt (random per encryption)
44+K      12B      Header nonce (random per encryption)
56+K      8B       Nonce prefix (random per encryption)
64+K      8B       Plaintext size (uint64 BE)
72+K      2B       MIME type length M (uint16 BE)
74+K      MB       MIME type (UTF-8)
74+K+M    4B       Chunk size in bytes (uint32 BE)
78+K+M    4B       Chunk count (uint32 BE)
82+K+M    32B      Raw SHA-256 of plaintext (32 raw bytes, NOT hex)
114+K+M   16B      Header auth tag (AES-256-GCM tag)
```

**Total header size:** `130 + K + M` bytes

Where K = `Buffer.byteLength(keyId, 'utf-8')` and M = `Buffer.byteLength(mimeType, 'utf-8')`.

For the default `key-v1` (K=6) and `application/pdf` (M=15):
- Header size = 130 + 6 + 15 = **151 bytes**

### 1.2 Changes from MVLT v2

| Field | v2 | v3 |
|-------|----|----|
| Format version | 2 | 3 |
| Header length field | Absent | Present (uint32 BE at offset 7) |
| Object salt | Absent | 32B random per encryption |
| Header nonce | Absent (HKDF-derived) | 12B random per encryption |
| Nonce prefix | Absent | 8B random per encryption |
| SHA-256 storage | 64B ASCII hex | 32B raw binary digest |
| Header auth key derivation | `HKDF(salt=empty, info="MVLT-HA")` | `HKDF(salt=objectSalt, info="MVLT-HEADER-KEY" \|\| keyId)` |
| Chunk key derivation | `HKDF(salt=empty, info="MVLT-FK" \|\| sha256Hex)` | `HKDF(salt=objectSalt, info="MVLT-FILE-KEY" \|\| keyId)` |
| Chunk nonce derivation | `HKDF(salt=empty, info="MVLT-CN" \|\| i)` | `noncePrefix \|\| uint32BE(i)` (constructive) |
| Header size | 106 + K + M | 130 + K + M |

### 1.3 Chunk Layout

Following the header, each chunk i (for i = 0..chunkCount-1):

```
[12B]  Chunk nonce = noncePrefix || uint32BE(i)
[16B]  Chunk auth tag (AES-256-GCM, AAD includes metadata)
[?B]   Chunk ciphertext (last chunk may be smaller than chunkSize)
```

**Per-chunk overhead:** 28 bytes (12 nonce + 16 tag)

### 1.4 Raw SHA-256 in Header

The 32-byte raw binary SHA-256 digest (not hex-encoded) serves two purposes:
1. **Integrity verification** — compared after decryption to detect corruption
2. **Content-addressable identifier** — the hex form is used for dedup and DB lookup
3. **Chunk AAD binding** — included in every chunk's AAD to bind chunks to their file

---

## 2. Header AAD Specification

The header is authenticated independently from the chunks using AES-256-GCM in
"tag-only" mode (zero-length plaintext).

### 2.1 Header Auth Key Derivation

```
headerAuthKey = HKDF-SHA256(
  IKM  = masterKey (32 bytes),
  salt = objectSalt (32 bytes, random per encryption),
  info = Buffer.concat(["MVLT-HEADER-KEY", keyId (UTF-8)]),
  L    = 32 bytes
)
```

- `objectSalt` is a **random 32-byte value** generated fresh for each encryption
- `keyId` is the non-secret key version identifier (e.g. `"key-v1"`)
- The info string concatenation is: `"MVLT-HEADER-KEY"` (15 bytes) + `keyId` (K bytes)

### 2.2 Authentication

```
headerNonce = 12 random bytes per encryption (stored in header at offset 44+K)
AAD        = all header bytes EXCLUDING the final 16-byte auth tag
             = bytes [0 .. headerLength - 16)
Plaintext   = zero-length (empty buffer)
Tag        = 16-byte GCM auth tag (stored as final 16 bytes of header)
```

Construction:
1. Serialize all header fields into the pre-tag buffer
2. Create `AES-256-GCM(headerAuthKey, headerNonce)`, set AAD to pre-tag buffer
3. Encrypt empty plaintext, extract 16-byte auth tag
4. Concatenate: `preTag || headerTag`

Verification:
1. Split header buffer at `headerLength - 16`
2. Derive `headerAuthKey` from `objectSalt` (read from header) + `keyId` (read from header)
3. Create `AES-256-GCM(headerAuthKey, headerNonce)`, set AAD to pre-tag, set auth tag
4. Decrypt empty plaintext; throws on mismatch → header rejected, no fields trusted

---

## 3. Chunk AAD Specification

Each chunk is independently authenticated with a metadata-rich AAD buffer.

### 3.1 AAD Format

```
Offset  Size     Field
------  -------  -----
0       2B       formatVersion (uint16 BE)
2       1B       keyId length K (uint8)
3       KB       keyId (UTF-8)
3+K     32B      rawSha256 (32 raw bytes)
35+K    4B       chunkIndex (uint32 BE, 0-based)
39+K    4B       plaintextChunkLength (uint32 BE)
43+K    4B       totalChunkCount (uint32 BE)
```

**Total AAD size:** `47 + K` bytes

### 3.2 AAD Construction

```typescript
// From encrypt.ts — buildChunkAad()
const aad = Buffer.alloc(2 + 1 + keyIdBuf.length + 32 + 4 + 4 + 4)
aad.writeUInt16BE(formatVersion, 0)      // 2B
aad.writeUInt8(keyIdBuf.length, 2)        // 1B
keyIdBuf.copy(aad, 3)                     // KB
rawSha256.copy(aad, 3 + K)                // 32B
aad.writeUInt32BE(chunkIndex, 35 + K)     // 4B
aad.writeUInt32BE(plaintextChunkLength, 39 + K)  // 4B
aad.writeUInt32BE(totalChunkCount, 43 + K)       // 4B
```

### 3.3 AAD Properties

- **Per-chunk unique:** `chunkIndex` differs per chunk
- **File-bound:** `rawSha256` binds the chunk to its specific file
- **Format-bound:** `formatVersion` prevents cross-version attacks
- **Key-bound:** `keyId` ensures chunks encrypted with different keys can't be swapped
- **Size-bound:** `plaintextChunkLength` and `totalChunkCount` prevent truncation/extension attacks

---

## 4. Key Derivation and Nonce Uniqueness Proof

### 4.1 Per-Object Random Values

Each encrypted object generates three independent random values:

| Value | Size | Source | Purpose |
|-------|------|--------|---------|
| `objectSalt` | 32 bytes | `crypto.randomBytes(32)` | HKDF salt for file key + header key derivation |
| `noncePrefix` | 8 bytes | `crypto.randomBytes(8)` | Prefix for all chunk nonces in this object |
| `headerNonce` | 12 bytes | `crypto.randomBytes(12)` | GCM nonce for header authentication |

### 4.2 File Key Derivation

```
fileKey = HKDF-SHA256(
  IKM  = masterKey (32 bytes),
  salt = objectSalt (32 bytes),
  info = Buffer.concat(["MVLT-FILE-KEY", keyId (UTF-8)]),
  L    = 32 bytes
)
```

### 4.3 Chunk Nonce Construction

```
chunkNonce(i) = noncePrefix (8B) || uint32BE(i) (4B) = 12 bytes
```

This is a simple concatenation — not HKDF — enabling deterministic reconstruction
from the header's `noncePrefix` field for seek operations.

### 4.4 Nonce Uniqueness Proof

**File key uniqueness:**
- `objectSalt` is 32 bytes of randomness per object
- Two objects producing the same `fileKey` requires a 256-bit collision in HKDF output
- Collision probability: **2^-256** (negligible)

**Chunk nonce uniqueness within an object:**
- `noncePrefix` (8B random) is fixed; `uint32BE(i)` provides the per-chunk counter
- For a single object, nonces are trivially unique by counter

**Cross-object chunk nonce uniqueness:**
- Even if two objects somehow shared the same `fileKey` (probability 2^-256):
  - Nonce collision requires `noncePrefix_1 || i = noncePrefix_2 || j`
  - With 8 random bytes, collision probability per pair is **2^-64**
  - GCM's safety margin requires nonce uniqueness probability < 2^-32
  - **2^-64 is well within the 2^-32 safety margin**

**Combined guarantee:**
- Probability of any (key, nonce) reuse across N objects: bounded by N^2 * 2^-64
- Even at N = 10^6 objects, probability ≈ 10^12 * 2^-64 ≈ 2^-64 * 2^40 = 2^-24... still negligible
- For any realistic deployment, nonce reuse is computationally impossible

### 4.5 Header Nonce Uniqueness

- `headerNonce` (12B random) eliminates the v2 issue of deterministic header nonces
- Even if `objectSalt` collides (2^-256), the independent `headerNonce` provides
  additional separation for header authentication
- Each header authentication uses a unique (headerAuthKey, headerNonce) pair

---

## 5. Key Versioning

### 5.1 Key ID

- Each master key has a non-secret `keyId` (e.g. `"key-v1"`, `"key-v2"`)
- The `keyId` is stored in:
  1. The MVLT v3 file header (plaintext field at offset 12, K bytes)
  2. The `StoredObject.keyId` database column
- `keyId` is **not secret** — it identifies which master key to use, not the key itself
- `keyId` is included in HKDF info strings, ensuring different master keys produce
  completely different file keys and header auth keys even with the same `objectSalt`

### 5.2 KeyRing Class

The `KeyRing` class is an in-memory map of `keyId -> masterKeyHex`:

```typescript
const ring = new KeyRing()
ring.add({ keyId: 'key-v1', masterKeyHex: '...' })
ring.add({ keyId: 'key-v2', masterKeyHex: '...' })

// Get primary (first added) key — used for new encryptions
const primary = ring.getPrimary()

// Resolve key by ID — used for decryption of files encrypted with a specific version
const entry = ring.get('key-v1')

// Check existence
ring.has('key-v2')  // true
ring.keyIds()       // ['key-v1', 'key-v2']
```

### 5.3 Key Resolution at Decryption Time

```typescript
// From storage-service.ts — resolveKeyEntry()
private resolveKeyEntry(keyId: string) {
  if (this.keyRing.has(keyId)) {
    return this.keyRing.get(keyId)
  }
  // Fallback to primary key (files encrypted before key versioning)
  return this.keyRing.getPrimary()
}
```

### 5.4 Rotation Workflow (Design)

> **Status: Design-only. Not yet implemented.**

1. Generate new master key, register as `key-v2` in `MEDIVAULT_ROTATION_KEYS`
2. Set `key-v2` as primary (new uploads use it)
3. Batch re-encrypt: decrypt with `key-v1`, re-encrypt with `key-v2`
4. Update `StoredObject.keyId` for each re-encrypted file
5. Once all files migrated, deactivate `key-v1`

### 5.5 Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `MEDIVAULT_MASTER_KEY` | Primary master key (64-char hex) | Yes |
| `MEDIVAULT_ROTATION_KEYS` | JSON array of `[{keyId, masterKeyHex}]` for rotation | No |

### 5.6 KeyRing.fromEnv()

```typescript
// Auto-loads from environment on startup
const ring = KeyRing.fromEnv()
// 1. Reads MEDIVAULT_MASTER_KEY -> registers as 'key-v1'
// 2. Reads MEDIVAULT_ROTATION_KEYS (JSON) -> registers each entry
```

---

## 6. Storage Path

### 6.1 Content-Addressable Path Format

```
{MEDIVAULT_DATA_DIR}/objects/{sha256[0:2]}/{fullSha256}.enc
```

**Examples:**
```
/var/lib/medivault/objects/ab/ab12cd34...ef567890123456789012345678901234567890123456789012345678abcd.enc
```

### 6.2 Path Properties

- **Single prefix directory** — first 2 hex chars of SHA-256 (256 possible subdirectories)
- **Content-addressable** — filenames never appear in physical paths (prevents path
  traversal attacks and enables deduplication)
- **Relative path for DB storage** — `objects/{prefix}/{sha256}.enc` (stored in
  `StoredObject.encryptedPath`)
- **Path traversal protection** — filenames validated against `../` patterns, absolute
  paths, path separators, and a safe-character regex (`/^[a-zA-Z0-9._-]+$/`)

---

## 7. Two-Pass Streaming Encryption

For large files, `EncryptedStorageService.storeStream()` uses a true two-pass
streaming approach that never loads the full plaintext into memory.

### 7.1 Phase 1: Stream to Temp Plaintext File

- Create temp directory: `os.tmpdir()/mvlt-XXXXXX/`
- Open temp plaintext file with mode `0600` (owner-read/write only)
- Pipe input stream to temp file while computing SHA-256 via `crypto.createHash('sha256')`
- Output: `sha256` (hex), `rawSha256` (32B Buffer), `size` (number)

### 7.2 Phase 2: Dedup Check

- Compute object path: `objects/{sha256[0:2]}/{sha256}.enc`
- If file exists: parse header, securely delete temp plaintext, return deduplicated result
- If not: check disk space (1.5x safety margin via `statfs`), proceed to encryption

### 7.3 Phase 3: Stream-Encrypt from Temp File

- Generate `objectKeys` (objectSalt, noncePrefix, headerNonce) via `crypto.randomBytes()`
- Derive `fileKey` via HKDF
- Build authenticated MVLT v3 header
- Open temp encrypted file for writing
- Write header, then `fsync`
- For each chunk:
  - Read `min(1 MiB, remaining)` from temp plaintext file into a 1 MiB read buffer
  - Build chunk AAD (47+K bytes)
  - Encrypt chunk: `encryptSingleChunk(plaintext, fileKey, noncePrefix, i, aad)`
  - Write `nonce(12) + authTag(16) + ciphertext` to temp encrypted file
- `fsync` temp encrypted file
- Set permissions to `0600`

### 7.4 Phase 4: Atomic Finalize

- `mkdir -p` for the prefix directory
- Atomic `rename(tmpEncFile, objectPath)`
- Re-set permissions to `0600` after rename (rename may reset on some systems)
- Securely delete temp plaintext file (overwrite with zeros for files < 100 MB, then `unlink`)
- Clean up temp directory

### 7.5 Memory Bound

- **Read buffer:** 1 MiB (`PLAINTEXT_READ_CHUNK = 1048576`)
- **Encrypted chunk in memory:** at most `1 MiB + 28 bytes` overhead per chunk
- **No full-file buffers** — only one chunk is ever in memory at a time
- Stale temp files from crashed runs are cleaned up on service construction
  (files with `mvlt-*` prefix older than 1 hour)

---

## 8. Soft-Delete and Garbage Collection Design

### 8.1 Document Soft-Delete

- `DELETE /api/documents/[id]` sets `Document.deletedAt = new Date()`
- The document is immediately hidden from all read queries (`WHERE deletedAt IS NULL`)
- The encrypted file is **not** physically deleted yet

### 8.2 StoredObject Reference Counting

After soft-deleting a document, the system checks if any active references remain:

```typescript
// From DELETE /api/documents/[id]
const activeRefs = await db.document.count({
  where: { storedObjectId, deletedAt: null, id: { not: document.id } },
})
const versionRefs = await db.documentVersion.count({
  where: { storedObjectId },
})
const currentVersionRefs = await db.document.count({
  where: { documentVersionId: storedObjectId, deletedAt: null },
})

if (activeRefs === 0 && versionRefs === 0 && currentVersionRefs === 0) {
  // No active references — mark for deferred physical deletion
  await db.storedObject.update({
    where: { id: storedObjectId },
    data: { pendingDeletionAt: new Date() },
  })
}
```

### 8.3 StoredObject Retention

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `pendingDeletionAt` | `DateTime?` | null | Set when no active references remain |
| `retentionDays` | `Int` | 30 | Days to keep file before physical deletion |

### 8.4 Garbage Collection (Design)

> **Status: Physical deletion is deferred. A GC step to actually delete expired
> files from disk has not been implemented yet.**

The intended GC workflow:
1. Query `StoredObject` records where `pendingDeletionAt IS NOT NULL`
2. For each: if `now - pendingDeletionAt > retentionDays * 86400000`, delete the
   physical encrypted file via `EncryptedStorageService.deletePhysical(sha256Hash)`
3. Remove the `StoredObject` row from PostgreSQL

### 8.5 Document Restore

- `POST /api/documents/[id]/restore`
- Sets `Document.deletedAt = null`
- Checks retention period: if `elapsed > retentionDays * 86400000`, returns HTTP 410
  (Gone) — the physical file may have already been garbage-collected
- If within retention period, the document is fully restored (the encrypted file
  still exists on disk)

---

## 9. Security Invariants

1. **No encryption keys in PostgreSQL** — only SHA-256 hashes and non-secret keyIds
   are stored in `StoredObject`
2. **No encryption keys in source control** — `.gitignore` excludes `.env` files
3. **No encryption keys in logs** — all logging uses `[REDACTED]` for key material
4. **Only env vars for crypto** — `MEDIVAULT_MASTER_KEY` and `MEDIVAULT_DATA_DIR`
5. **Content-addressable storage** — filenames never appear in physical paths;
   all paths are derived from SHA-256 hashes
6. **Atomic writes** — temp file + `fs.rename` prevents partial/corrupt files on
   disk; `fsync` called before rename
7. **Deduplication** — identical content (same SHA-256) is stored once, saving disk
   space; dedup is detected before encryption begins
8. **Per-object key derivation** — each object gets a random 32B `objectSalt`;
   compromising one object's derived key does not expose other objects
9. **Independent chunk authentication** — each chunk has its own GCM auth tag
   with metadata-rich AAD; tampering any single chunk is detected without
   decrypting other chunks
10. **Header authentication** — header metadata (size, MIME, SHA-256, keyId,
    chunk count) is authenticated independently via a separate AES-GCM tag-only
    operation with a per-object random `headerNonce`
11. **Restrictive file permissions** — all encrypted files and temp files are
    created with mode `0600` (owner read/write only)
12. **Secure temp file deletion** — plaintext temp files are overwritten with
    zeros (for files < 100 MB) before `unlink` to reduce forensic recoverability
13. **MIME type allowlist** — only 8 medical-relevant MIME types are accepted;
    all others are rejected at the storage service level
14. **Path traversal protection** — filenames are validated against `../`, absolute
    paths, path separators, and a safe-character regex before any processing
15. **Chunk nonce construction is deterministic** — given the header's `noncePrefix`,
    any chunk's nonce can be recomputed without scanning, enabling efficient
    range-request decryption of individual chunks

---

## 10. Current Security Risks (as of Milestone 3)

1. **Key material held in process memory.**
   The master key (and derived keys) are loaded into process memory and held for
   the lifetime of the server process. A memory dump (e.g., via a kernel
   vulnerability or core dump) could expose the master key. Mitigation: minimize
   key lifetime where possible, rely on OS memory protection, and avoid logging
   or serializing key material.

2. **DPAPI / Windows Credential Manager integration is unimplemented.**
   The master key is currently stored in the `MEDIVAULT_MASTER_KEY` environment
   variable (plaintext on disk in `.env` files). On Windows production deployments,
   DPAPI should protect the key at rest. This is a design-only feature pending
   Tauri integration.

3. **Key rotation is design-only.**
   The `KeyRing` class supports multiple keys, and the `keyId` field in headers
   and the database enables identification. However, the actual rotation workflow
   (batch re-encrypt all files with a new master key and update `StoredObject.keyId`)
   is not implemented.

4. **Recovery key is design-only.**
   The environment variable `MEDIVAULT_MASTER_RECOVERY_KEY` and the associated
   disaster recovery workflow (re-encrypt all files with a new primary key) exist
   only as a design concept. Loss of the primary master key currently means
   permanent data loss.

5. **Garbage collection for soft-deleted files is not implemented.**
   `StoredObject.pendingDeletionAt` and `StoredObject.retentionDays` are set when
   a document is soft-deleted and no active references remain, but no background
   process actually deletes the physical encrypted files after the retention
   period expires. Files accumulate indefinitely.

---

## 11. Allowed File Types

| MIME Type | Extensions | Description |
|-----------|-----------|-------------|
| `application/pdf` | `.pdf` | PDF documents |
| `image/jpeg` | `.jpg`, `.jpeg` | JPEG images |
| `image/png` | `.png` | PNG images |
| `image/webp` | `.webp` | WebP images |
| `image/heic` | `.heic` | HEIC images (iPhone) |
| `image/heif` | `.heif` | HEIF images |
| `image/bmp` | `.bmp` | BMP images |
| `image/tiff` | `.tiff`, `.tif` | TIFF images |

All other MIME types are rejected at the storage service level via
`ALLOWED_MIME_TYPES` Set in `constants.ts`.
