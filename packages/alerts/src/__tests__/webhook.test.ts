import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isUrlAllowed, isUrlAllowedAsync } from '../delivery/webhook.js';

describe('isUrlAllowed (sync)', () => {
  // ── Allowed URLs ─────────────────────────────────────────────────────────
  it('allows https external URL', () => {
    expect(isUrlAllowed('https://example.com/webhook')).toBe(true);
  });

  it('allows http external URL', () => {
    expect(isUrlAllowed('http://203.0.113.50/hook')).toBe(true);
  });

  it('allows public IPv6 address', () => {
    expect(isUrlAllowed('http://[2001:db8::1]/hook')).toBe(true);
  });

  // ── Blocked protocols ────────────────────────────────────────────────────
  it('blocks ftp protocol', () => {
    expect(isUrlAllowed('ftp://example.com')).toBe(false);
  });

  it('blocks file protocol', () => {
    expect(isUrlAllowed('file:///etc/passwd')).toBe(false);
  });

  it('blocks empty string', () => {
    expect(isUrlAllowed('')).toBe(false);
  });

  it('blocks malformed URL', () => {
    expect(isUrlAllowed('not-a-url')).toBe(false);
  });

  // ── Blocked IPv4 private ranges ──────────────────────────────────────────
  it('blocks 10.x.x.x', () => {
    expect(isUrlAllowed('http://10.0.0.1')).toBe(false);
  });

  it('blocks 172.16.x.x', () => {
    expect(isUrlAllowed('http://172.16.5.1')).toBe(false);
  });

  it('blocks 172.31.x.x', () => {
    expect(isUrlAllowed('http://172.31.255.255')).toBe(false);
  });

  it('allows 172.15.x.x (not private)', () => {
    expect(isUrlAllowed('http://172.15.0.1')).toBe(true);
  });

  it('blocks 192.168.x.x', () => {
    expect(isUrlAllowed('http://192.168.1.1')).toBe(false);
  });

  it('blocks 169.254.169.254 (cloud metadata)', () => {
    expect(isUrlAllowed('http://169.254.169.254')).toBe(false);
  });

  // ── Blocked hostnames ────────────────────────────────────────────────────
  it('blocks localhost', () => {
    expect(isUrlAllowed('http://localhost')).toBe(false);
  });

  it('blocks 127.0.0.1', () => {
    expect(isUrlAllowed('http://127.0.0.1')).toBe(false);
  });

  it('blocks 0.0.0.0', () => {
    expect(isUrlAllowed('http://0.0.0.0')).toBe(false);
  });

  // ── Blocked IPv6 addresses ───────────────────────────────────────────────
  it('blocks [::1] (IPv6 loopback)', () => {
    expect(isUrlAllowed('http://[::1]')).toBe(false);
  });

  it('blocks [::ffff:127.0.0.1] (IPv4-mapped loopback)', () => {
    expect(isUrlAllowed('http://[::ffff:127.0.0.1]')).toBe(false);
  });

  it('blocks [::ffff:10.0.0.1] (IPv4-mapped private)', () => {
    expect(isUrlAllowed('http://[::ffff:10.0.0.1]')).toBe(false);
  });

  it('blocks [::ffff:192.168.1.1] (IPv4-mapped private)', () => {
    expect(isUrlAllowed('http://[::ffff:192.168.1.1]')).toBe(false);
  });

  it('blocks [::ffff:7f00:1] (IPv4-mapped hex form, 127.0.0.1)', () => {
    expect(isUrlAllowed('http://[::ffff:7f00:1]')).toBe(false);
  });

  it('blocks [::ffff:c0a8:101] (IPv4-mapped hex form, 192.168.1.1)', () => {
    expect(isUrlAllowed('http://[::ffff:c0a8:101]')).toBe(false);
  });

  it('blocks [::ffff:a00:1] (IPv4-mapped hex form, 10.0.0.1)', () => {
    expect(isUrlAllowed('http://[::ffff:a00:1]')).toBe(false);
  });

  it('blocks [fc00::1] (unique-local IPv6)', () => {
    expect(isUrlAllowed('http://[fc00::1]')).toBe(false);
  });

  it('blocks [fd12:3456::1] (unique-local IPv6)', () => {
    expect(isUrlAllowed('http://[fd12:3456::1]')).toBe(false);
  });

  it('blocks [fe80::1] (link-local IPv6)', () => {
    expect(isUrlAllowed('http://[fe80::1]')).toBe(false);
  });

  it('blocks [feb0::1] (link-local IPv6)', () => {
    expect(isUrlAllowed('http://[feb0::1]')).toBe(false);
  });
});

// ── Async tests with DNS mocking ─────────────────────────────────────────────

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

describe('isUrlAllowedAsync (with DNS resolution)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockDns(results: Array<{ address: string; family: number }>): Promise<void> {
    const dns = await import('node:dns/promises');
    vi.mocked(dns.lookup).mockResolvedValue(results as never);
  }

  async function mockDnsError(): Promise<void> {
    const dns = await import('node:dns/promises');
    vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
  }

  it('blocks when DNS resolves to 127.0.0.1', async () => {
    await mockDns([{ address: '127.0.0.1', family: 4 }]);
    expect(await isUrlAllowedAsync('https://evil.com/hook')).toBe(false);
  });

  it('blocks when DNS resolves to 10.x.x.x', async () => {
    await mockDns([{ address: '10.0.0.5', family: 4 }]);
    expect(await isUrlAllowedAsync('https://rebind.attacker.com/hook')).toBe(false);
  });

  it('allows when DNS resolves to public IP', async () => {
    await mockDns([{ address: '203.0.113.50', family: 4 }]);
    expect(await isUrlAllowedAsync('https://legit.com/hook')).toBe(true);
  });

  it('blocks when DNS resolution fails (fail-closed)', async () => {
    await mockDnsError();
    expect(await isUrlAllowedAsync('https://unknown.com/hook')).toBe(false);
  });

  it('blocks when any resolved IP is private (mixed results)', async () => {
    await mockDns([
      { address: '203.0.113.50', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    expect(await isUrlAllowedAsync('https://mixed.com/hook')).toBe(false);
  });

  it('skips DNS check for raw IPv4 addresses', async () => {
    const dns = await import('node:dns/promises');
    expect(await isUrlAllowedAsync('http://203.0.113.50/hook')).toBe(true);
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('rejects sync-blocked URLs before DNS check', async () => {
    const dns = await import('node:dns/promises');
    expect(await isUrlAllowedAsync('http://localhost/hook')).toBe(false);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});
