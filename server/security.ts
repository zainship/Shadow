import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === '::1' || clean === '::' || clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) {
    return true;
  }
  const v4Mapped = clean.startsWith('::ffff:') ? clean.slice(7) : clean;
  if (net.isIPv4(v4Mapped)) {
    const parts = v4Mapped.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export function assertPublicHttpUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are allowed.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateOrReservedIp(host)
  ) {
    throw new Error('Private, loopback, and link-local network addresses are blocked.');
  }
  return parsed;
}

export async function assertPublicHttpUrlWithDns(rawUrl: string): Promise<URL> {
  const parsed = assertPublicHttpUrl(rawUrl);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or loopback IP addresses are blocked.');
    }
    return parsed;
  }
  try {
    const resolved = await dns.lookup(host, { all: true });
    for (const entry of resolved) {
      if (isPrivateOrReservedIp(entry.address)) {
        throw new Error('Target host resolves to a restricted private or loopback IP address.');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('restricted')) {
      throw err;
    }
    // Let downstream fetch handle transient DNS failures if not explicitly private
  }
  return parsed;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}
