import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export type DnsLookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>

export const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  const results = await lookup(hostname, { all: true })
  return results.map((r) => ({ address: r.address, family: r.family }))
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null
  }
  return [parts[0], parts[1], parts[2], parts[3]]
}

function isPrivateIpv4Octets(a: number, b: number, c: number, _d: number): boolean {
  if (a === 0) return true // 0.0.0.0/8 (current network)
  if (a === 10) return true // 10.0.0.0/8 (private)
  if (a === 127) return true // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true // 169.254.0.0/16 (link-local / cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 (private)
  if (a === 192 && b === 168) return true // 192.168.0.0/16 (private)
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (carrier-grade NAT)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // 192.0.0.0/24 & TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true // 192.88.99.0/24 (6to4 relay)
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 (benchmarking)
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
  return false
}

function parseIpv6(raw: string): number[] | null {
  let ip = raw.trim().replace(/^\[|\]$/g, '')
  const lastColon = ip.lastIndexOf(':')
  if (lastColon !== -1) {
    const maybeIpv4 = ip.slice(lastColon + 1)
    if (maybeIpv4.includes('.')) {
      const parts = maybeIpv4.split('.').map((p) => Number(p))
      if (parts.length === 4 && parts.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255)) {
        const hex1 = ((parts[0] << 8) | parts[1]).toString(16)
        const hex2 = ((parts[2] << 8) | parts[3]).toString(16)
        ip = `${ip.slice(0, lastColon + 1)}${hex1}:${hex2}`
      }
    }
  }

  const halves = ip.split('::')
  if (halves.length > 2) return null
  let words: number[] = []
  if (halves.length === 1) {
    const parts = ip.split(':')
    if (parts.length !== 8) return null
    words = parts.map((w) => Number.parseInt(w, 16))
  } else {
    const left = halves[0] ? halves[0].split(':').map((w) => Number.parseInt(w, 16)) : []
    const right = halves[1] ? halves[1].split(':').map((w) => Number.parseInt(w, 16)) : []
    const missing = 8 - (left.length + right.length)
    if (missing < 1) return null
    words = [...left, ...Array<number>(missing).fill(0), ...right]
  }

  if (words.length !== 8 || words.some((w) => Number.isNaN(w) || w < 0 || w > 0xffff)) {
    return null
  }
  return words
}

function isPrivateIpv6Words(words: number[]): boolean {
  // Loopback ::1
  if (words.every((w, i) => (i === 7 ? w === 1 : w === 0))) return true
  // Unspecified ::
  if (words.every((w) => w === 0)) return true

  // IPv4-mapped (::ffff:0:0/96) or IPv4-compatible (::0:0/96)
  const isIpv4Mapped = words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff
  const isIpv4Compat = words.slice(0, 6).every((w) => w === 0)
  if (isIpv4Mapped || isIpv4Compat) {
    const a = (words[6] >> 8) & 0xff
    const b = words[6] & 0xff
    const c = (words[7] >> 8) & 0xff
    const d = words[7] & 0xff
    return isPrivateIpv4Octets(a, b, c, d)
  }

  // Unique local fc00::/7 (fc00:: - fdff::)
  if ((words[0] & 0xfe00) === 0xfc00) return true
  // Link-local fe80::/10 (fe80:: - febf::)
  if ((words[0] & 0xffc0) === 0xfe80) return true
  // Site-local (deprecated) fec0::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true
  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return true
  // Discard-only prefix 100::/64
  if (words[0] === 0x100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true
  // Documentation prefix 2001:db8::/32
  if (words[0] === 0x2001 && words[1] === 0xdb8) return true
  // 6to4 prefix 2002::/16
  if (words[0] === 0x2002) {
    const a = (words[1] >> 8) & 0xff
    const b = words[1] & 0xff
    const c = (words[2] >> 8) & 0xff
    const d = words[2] & 0xff
    if (isPrivateIpv4Octets(a, b, c, d)) return true
  }

  return false
}

export function isPrivateIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, '')
  const ipVersion = isIP(clean)
  if (ipVersion === 4) {
    const octets = parseIpv4(clean)
    if (!octets) return true
    return isPrivateIpv4Octets(octets[0], octets[1], octets[2], octets[3])
  }
  if (ipVersion === 6) {
    const words = parseIpv6(clean)
    if (!words) return true
    return isPrivateIpv6Words(words)
  }
  return true
}

export async function assertSafeUrl(urlStr: string, lookupFn?: DnsLookupFn): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid URL protocol: "${parsed.protocol}". Only "http:" and "https:" are permitted for PDF URL ingest.`,
    )
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!hostname) {
    throw new Error(`Invalid URL: missing hostname in ${urlStr}`)
  }

  // Check forbidden hostname patterns
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.arpa')
  ) {
    throw new Error(`Access to local or internal hostname is forbidden: ${parsed.hostname}`)
  }

  // If hostname is an IP literal
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Access to private, loopback, or internal IP address is forbidden: ${hostname}`)
    }
    return parsed
  }

  // Resolve hostname via DNS
  const lookup = lookupFn ?? defaultDnsLookup
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await lookup(hostname)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not resolve hostname "${hostname}": ${msg}`)
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`No IP addresses found for hostname "${hostname}"`)
  }

  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new Error(
        `Access to private, loopback, or internal destination is forbidden: ${hostname} resolved to ${entry.address}`,
      )
    }
  }

  return parsed
}
