const LOCAL_API_URL = "http://localhost:3000/api/v1";
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function isLoopbackHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0")
    return true;
  const ipv4 = host.match(/^(\d+)\.\d+\.\d+\.\d+$/);
  return !!ipv4 && Number(ipv4[1]) === 127;
}

function browserPage(pageUrl?: string): URL | null {
  if (!pageUrl) return null;
  try {
    const page = new URL(pageUrl);
    return HTTP_PROTOCOLS.has(page.protocol) ? page : null;
  } catch {
    return null;
  }
}

// Browser builds use their own origin by default. Packaged desktop and
// non-browser callers retain the configured endpoint or local default.
export function resolveApiUrl(fromEnv?: string, pageUrl?: string): string {
  const page = browserPage(pageUrl);
  const configured = fromEnv?.trim().replace(/\/+$/, "");
  if (configured) {
    const url = new URL(configured);
    if (!HTTP_PROTOCOLS.has(url.protocol))
      throw new Error("VITE_API_URL phải là URL HTTP hoặc HTTPS.");
    if (page && !isLoopbackHost(page.hostname) && isLoopbackHost(url.hostname))
      return `${page.origin}/api/v1`;
    if (url.pathname === "/") url.pathname = "/api/v1";
    return url.href.replace(/\/$/, "");
  }

  return page ? `${page.origin}/api/v1` : LOCAL_API_URL;
}

export function apiConnectionFailure(timedOut: boolean) {
  return timedOut
    ? { status: 504, message: "Máy chủ phản hồi quá lâu. Hãy thử lại." }
    : { status: 0, message: "Không kết nối được máy chủ Viễn Du. Hãy kiểm tra mạng và địa chỉ API." };
}
