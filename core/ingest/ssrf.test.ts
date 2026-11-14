import { describe, expect, it } from 'vitest'
import { assertSafeUrl, isPrivateIp, type DnsLookupFn } from './ssrf'

const publicLookup: DnsLookupFn = async () => [{ address: '93.184.216.34', family: 4 }]

describe('isPrivateIp', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])('blocks special-purpose IPv4 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '172.15.255.255'])(
    'allows public IPv4 %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    },
  )

  it.each([
    '::',
    '::1',
    '::ffff:7f00:1',
    '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:a00:1',
    '::7f00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
    '100::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])('blocks special-purpose IPv6 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each(['2606:4700::1', '2a00:1450:4001::1', '::ffff:808:808'])('allows public IPv6 %s', (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })

  // Address families that embed an IPv4 destination: a NAT64 or SIIT
  // translator on the user's network turns these into IPv4 connections, so
  // the embedded address must get the same private-range check as a literal.
  it.each([
    ['NAT64 well-known prefix -> loopback', '64:ff9b::7f00:1'],
    ['NAT64 well-known prefix -> 10/8', '64:ff9b::a00:1'],
    ['NAT64 well-known prefix -> metadata', '64:ff9b::a9fe:a9fe'],
    ['NAT64 local-use prefix', '64:ff9b:1::a00:1'],
    ['IPv4-translated (SIIT) -> loopback', '::ffff:0:7f00:1'],
    ['IPv4-translated (SIIT) -> metadata', '::ffff:0:a9fe:a9fe'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
  ])('blocks %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it('allows NAT64 addresses that embed a public IPv4', () => {
    expect(isPrivateIp('64:ff9b::808:808')).toBe(false)
  })

  it('treats non-IP strings as unsafe', () => {
    expect(isPrivateIp('example.com')).toBe(true)
    expect(isPrivateIp('')).toBe(true)
  })
})

describe('assertSafeUrl', () => {
  it.each([
    'http://2130706433/',
    'http://0x7f.0.0.1/',
    'http://0177.0.0.1/',
    'http://127.1/',
    'http://0/',
    'http://[::ffff:127.0.0.1]/',
    'http://[0:0:0:0:0:ffff:169.254.169.254]/',
  ])('blocks alternate encodings of private IPs: %s', async (url) => {
    await expect(assertSafeUrl(url, publicLookup)).rejects.toThrow(/forbidden/)
  })

  it.each(['http://[64:ff9b::127.0.0.1]/', 'http://[::ffff:0:169.254.169.254]/'])(
    'blocks IPv6 literals that translate to private IPv4: %s',
    async (url) => {
      await expect(assertSafeUrl(url, publicLookup)).rejects.toThrow(/forbidden/)
    },
  )

  it.each([
    'http://localhost/',
    'http://LOCALHOST/',
    'http://api.localhost/',
    'http://printer.local/',
    'http://metadata.google.internal/',
    'http://1.0.0.127.in-addr.arpa/',
  ])('blocks local hostname %s without consulting DNS', async (url) => {
    await expect(assertSafeUrl(url, publicLookup)).rejects.toThrow(/forbidden/)
  })

  it.each(['http://localhost./', 'http://metadata.google.internal./', 'http://printer.local../'])(
    'blocks local hostname with trailing dot %s',
    async (url) => {
      await expect(assertSafeUrl(url, publicLookup)).rejects.toThrow(/forbidden/)
    },
  )

  it('rejects non-http(s) schemes and malformed URLs', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', publicLookup)).rejects.toThrow(/protocol/)
    await expect(assertSafeUrl('not a url', publicLookup)).rejects.toThrow(/Invalid URL/)
  })

  it('rejects a hostname when any resolved address is private', async () => {
    const mixed: DnsLookupFn = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]
    await expect(assertSafeUrl('https://example.org/a.pdf', mixed)).rejects.toThrow(/resolved to 10\.0\.0\.5/)
  })

  it('rejects a hostname that resolves to a NAT64 address embedding a private IPv4', async () => {
    const nat64: DnsLookupFn = async () => [{ address: '64:ff9b::a9fe:a9fe', family: 6 }]
    await expect(assertSafeUrl('https://example.org/a.pdf', nat64)).rejects.toThrow(/forbidden/)
  })

  it('rejects unresolvable hostnames and empty DNS answers', async () => {
    const failing: DnsLookupFn = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(assertSafeUrl('https://nope.example/', failing)).rejects.toThrow(/Could not resolve/)
    await expect(assertSafeUrl('https://empty.example/', async () => [])).rejects.toThrow(/No IP addresses/)
  })

  it('accepts a public hostname and public IP literals', async () => {
    await expect(assertSafeUrl('https://arxiv.org/pdf/2401.12345', publicLookup)).resolves.toBeInstanceOf(URL)
    await expect(assertSafeUrl('https://8.8.8.8/a.pdf', publicLookup)).resolves.toBeInstanceOf(URL)
    await expect(assertSafeUrl('https://[2606:4700::1]/a.pdf', publicLookup)).resolves.toBeInstanceOf(URL)
  })
})
