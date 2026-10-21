// Web and desktop share the build-time endpoint; localhost is for local use.
export function resolveApiUrl(fromEnv?: string): string {
  const localhost = "http://localhost:3000/api/v1";
  const configured = fromEnv?.trim().replace(/\/+$/, "");
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error("VITE_API_URL phải là URL HTTP hoặc HTTPS.");
    return url.pathname === "/" ? `${configured}/api/v1` : configured;
  }

  return localhost;
}

export function apiConnectionFailure(timedOut: boolean) {
  return timedOut
    ? { status: 504, message: "Máy chủ phản hồi quá lâu. Hãy thử lại." }
    : { status: 0, message: "Không kết nối được máy chủ Viễn Du. Hãy kiểm tra mạng và địa chỉ API." };
}
