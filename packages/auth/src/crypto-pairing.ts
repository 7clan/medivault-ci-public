/**
 * @medivault/auth — Cryptographic Device Pairing Utilities
 *
 * Provides challenge-response verification for device pairing using ECDSA-P256-SHA256.
 * No imports from Next.js, Prisma, or any web framework.
 */

import { randomBytes, createVerify } from 'crypto'

/**
 * Generate a server-side challenge nonce (32 random bytes → 64-char hex string).
 * The device must sign this nonce with its private key to prove identity.
 */
export function generateChallengeNonce(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Verify an ECDSA-P256-SHA256 signature over a challenge nonce.
 *
 * @param challenge - The 64-char hex nonce that was signed.
 * @param signature - The device's DER-encoded signature (hex or base64).
 * @param publicKey - The device's PEM-encoded SPKI public key (EC P-256).
 * @returns true if the signature is valid, false otherwise.
 */
export async function verifySignature(
  challenge: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  try {
    // Normalize: if the publicKey doesn't have PEM headers, add them
    let pemKey = publicKey.trim()
    if (!pemKey.startsWith('-----BEGIN')) {
      // Assume it's a base64-encoded SPKI DER key
      pemKey = `-----BEGIN PUBLIC KEY-----\n${pemKey}\n-----END PUBLIC KEY-----`
    }

    // The challenge was hex-encoded; convert to buffer for signing
    const challengeBuf = Buffer.from(challenge, 'hex')

    // The signature may be hex or base64; try hex first, fall back to base64
    let sigBuf: Buffer
    try {
      sigBuf = Buffer.from(signature, 'hex')
      // If hex decoding produces an obviously wrong result (too short), try base64
      if (sigBuf.length < 8) {
        sigBuf = Buffer.from(signature, 'base64')
      }
    } catch {
      sigBuf = Buffer.from(signature, 'base64')
    }

    const verifier = createVerify('SHA256')
    verifier.update(challengeBuf)
    verifier.end()

    return verifier.verify(pemKey, sigBuf)
  } catch {
    return false
  }
}
