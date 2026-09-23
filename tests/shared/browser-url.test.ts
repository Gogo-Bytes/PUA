import { expect, it } from 'vitest';
import { normalizeBrowserURL } from '../../src/shared/ipc/browser';

it('normalizes remote HTTPS and permits only loopback HTTP development URLs', () => {
  expect(normalizeBrowserURL('example.com/path')).toBe('https://example.com/path');
  expect(normalizeBrowserURL('http://localhost:3000')).toBe('http://localhost:3000/');
  expect(normalizeBrowserURL('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  expect(normalizeBrowserURL('http://[::1]:3000')).toBe('http://[::1]:3000/');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com', 'https://user:secret@example.com', 'https://example.com/\n']) expect(normalizeBrowserURL(url)).toBeNull();
});
