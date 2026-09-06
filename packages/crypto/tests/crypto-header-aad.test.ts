import { describe, it, expect } from 'vitest'
import { createDecipheriv, createCipheriv } from 'node:crypto'
import { encrypt, parseEncryptedHeader, deriveHeaderAuthKey, parseMasterKeyHex, ALGORITHM, HEADER_TAG_SIZE, OBJECT_SALT_SIZE } from '../src'

const MASTER_KEY = 'a'.repeat(64)
const WRONG_KEY = 'b'.repeat(64)

describe('crypto-header-aad', () => {
  it('header auth passes with correct key', () => {
    const { encryptedData } = encrypt(Buffer.from('hello'), MASTER_KEY, 'application/pdf')
    // This should not throw
    const header = parseEncryptedHeader(encryptedData, MASTER_KEY)
    expect(header.formatVersion).toBe(3)
  })

  it('header auth fails with wrong master key', () => {
    const { encryptedData } = encrypt(Buffer.from('hello'), MASTER_KEY, 'application/pdf')
    expect(() => parseEncryptedHeader(encryptedData, WRONG_KEY)).toThrow()
  })

  it('header auth fails with tampered pre-tag bytes', () => {
    const { encryptedData } = encrypt(Buffer.from('hello'), MASTER_KEY, 'application/pdf')
    const tampered = Buffer.from(encryptedData)
    // Tamper with the magic bytes (in pre-tag section)
    tampered[0] ^= 0xff
    expect(() => parseEncryptedHeader(tampered, MASTER_KEY)).toThrow()
  })

  it('header auth fails with tampered objectSalt', () => {
    const { encryptedData } = encrypt(Buffer.from('hello'), MASTER_KEY, 'application/pdf')
    const tampered = Buffer.from(encryptedData)
    // objectSalt is at offset 11 + 1 + keyIdLen
    const keyIdLen = tampered.readUInt8(11)
    const saltOffset = 11 + 1 + keyIdLen
    tampered[saltOffset] ^= 0xff
    // This will cause header auth to fail because the header auth key is derived from objectSalt
    // but the pre-tag bytes (which include the tampered salt) no longer match the tag
    expect(() => parseEncryptedHeader(tampered, MASTER_KEY)).toThrow()
  })
})
