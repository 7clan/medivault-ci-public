import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encrypt, decrypt, parseMasterKeyHex } from '../src'

const MASTER_KEY = 'a'.repeat(64)
const WRONG_KEY = 'b'.repeat(64)

describe('crypto-key-wrong', () => {
  it('wrong key -> auth failure', () => {
    const data = randomBytes(10_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    expect(() => decrypt(encryptedData, WRONG_KEY)).toThrow()
  })

  it('corrupted key hex -> error', () => {
    const data = randomBytes(10_000)
    const { encryptedData } = encrypt(data, MASTER_KEY, 'application/pdf')
    expect(() => decrypt(encryptedData, 'zzzz-not-hex-at-all!!!')).toThrow()
  })
})
