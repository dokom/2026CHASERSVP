import { describe, it, expect } from 'vitest'
import { buildCsp } from '@/lib/security/csp'

const NONCE = 'abc123XYZ=='

describe('buildCsp', () => {
  it('includes the nonce in script-src exactly once', () => {
    const csp = buildCsp(NONCE, false)
    const matches = csp.match(new RegExp(`'nonce-${NONCE}'`, 'g')) ?? []
    expect(matches).toHaveLength(1)
    expect(csp).toMatch(new RegExp(`script-src[^;]*'nonce-${NONCE}'`))
  })

  it('allows unsafe-eval only in dev', () => {
    expect(buildCsp(NONCE, true)).toMatch(/script-src[^;]*'unsafe-eval'/)
    expect(buildCsp(NONCE, false)).not.toMatch(/'unsafe-eval'/)
  })

  it('never allows unsafe-inline in script-src', () => {
    const csp = buildCsp(NONCE, false)
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))
    expect(scriptSrc).toBeDefined()
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('sets frame-ancestors to none', () => {
    expect(buildCsp(NONCE, false)).toContain("frame-ancestors 'none'")
  })

  it('produces a single-line string with no newlines', () => {
    expect(buildCsp(NONCE, false)).not.toMatch(/\n/)
  })
})
