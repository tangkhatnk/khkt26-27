export type AuthMode = "login" | "register";
export type AuthFields = { name: string; email: string; password: string; confirmation: string };
export type AuthFieldErrors = Partial<Record<keyof AuthFields, string>>;

export function registrationPasswordChecks(password: string): { label: string; met: boolean }[] {
  return [
    { label: "Từ 8 đến 72 ký tự", met: password.length >= 8 && password.length <= 72 },
    { label: "Có chữ hoa A–Z", met: /[A-Z]/.test(password) },
    { label: "Có ít nhất một chữ số", met: /[0-9]/.test(password) },
    { label: "Có ký tự đặc biệt, như @ hoặc !", met: /[^a-zA-Z0-9]/.test(password) },
    { label: "Độ dài phù hợp khi dùng ký tự có dấu", met: new TextEncoder().encode(password).length <= 72 },
  ];
}

export function validateAuthFields(mode: AuthMode, fields: AuthFields): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  // Match the email shape accepted by the backend's z.email(), before sending.
  if (!/^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/.test(fields.email.trim()) || fields.email.trim().length > 255)
    errors.email = "Điền email đầy đủ, ví dụ ban@example.com.";
  if (!fields.password) errors.password = "Bạn chưa điền mật khẩu.";
  if (mode === "register") {
    const name = fields.name.trim();
    if (!name || name.length > 100 || !/^[\p{L}\p{N} .'-]+$/u.test(name))
      errors.name = "Điền tên từ 1–100 ký tự; dùng chữ, số, khoảng trắng, dấu chấm, nháy hoặc gạch nối.";
    const checks = registrationPasswordChecks(fields.password);
    if (!checks.every(check => check.met)) errors.password = !checks[4].met
      ? "Mật khẩu quá dài khi dùng ký tự có dấu. Hãy rút ngắn một chút."
      : "Mật khẩu chưa đủ các điều kiện bên dưới.";
    if (!fields.confirmation || fields.confirmation !== fields.password)
      errors.confirmation = "Hai mật khẩu chưa khớp. Hãy kiểm tra lại.";
  }
  return errors;
}
