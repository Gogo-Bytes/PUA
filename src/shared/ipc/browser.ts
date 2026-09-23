/** Remote pages are HTTPS-only; plain HTTP is allowed for loopback development servers. */
export function normalizeBrowserURL(input: string): string | null {
  if (/[\u0000-\u001f\u007f]/.test(input)) return null;
  const source = input.trim();
  if (!source || source.length > 4096) return null;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(source)?.[1];
  const explicitHttp = /^https?:\/\//i.test(source);
  const hostPort = /^(?:[a-z\d.-]+|\[[\da-f:]+\]):\d+(?:\/|$)/i.test(source);
  if (scheme && !/^https?$/i.test(scheme) && !hostPort) return null;
  let url: URL;
  try { url = new URL(explicitHttp ? source : `https://${source}`); }
  catch { return null; }
  if (url.username || url.password) return null;
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  return url.href;
}
