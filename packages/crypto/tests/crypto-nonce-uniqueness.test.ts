import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, parseEncryptedHeader } from '../src'

const MASTER_KEY = 'a'.repeat(64)

describe('crypto-nonce-uniqueness', () => {
  it('two encryptions produce different objectSalt', () => {
    const data = randomBytes(500)
    const h1 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY)
    const h2 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY)
    expect(h1.objectSalt.equals(h2.objectSalt)).toBe(false)
  })

  it('two encryptions produce different noncePrefix', () => {
    const data = randomBytes(500)
    const h1 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY)
    const h2 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY)
    expect(h1.noncePrefix.equals(h2.noncePrefix)).toBe(false)
  })

  it('two encryptions produce different headerNonce', () => {
    const data = randomBytes(500)
    const h1 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY);
    const h2 = parseEncryptedHeader(encrypt(data, MASTER_KEY, 'application/pdf').encryptedData, MASTER_KEY)
    expect(h1.headerNonce.equals(h2.headerNonce)).toBe(false)
  })
})
