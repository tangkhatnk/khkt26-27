export type AuthMode = "login" | "register";
export type AuthFields = { name: string; email: string; password: string; confirmation: string };
export type AuthFieldErrors = Partial<Record<keyof AuthFields, string>>;

export function registrationPasswordChecks(password: string): { label: string; met: boolean }[] {
  return [
    { label: "Từ 8 đến 72 ký tự", met: password.length >= 8 && password.length <= 72 },
    { label: "Có chữ hoa A–Z", met: /[A-Z]/.test(password) },
    { label: "Có ít nhất một chữ số", met: /[0-9]/.test(password) },
    { label: "Có ký tự đặc biệt, như @ hoặc !", met: /[^a-zA-Z0-9]/.test(password) },
    { label: "Tối đa 72 byte UTF-8 (ký tự có dấu có thể vượt giới hạn)", met: new TextEncoder().encode(password).length <= 72 },
  ];
}

export function validateAuthFields(mode: AuthMode, fields: AuthFields): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  // Match the email shape accepted by the backend's z.email(), before sending.
  if (!/^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/.test(fields.email.trim()) || fields.email.trim().length > 255)
    errors.email = "Điền email đầy đủ, ví dụ ban@example.com.";
  if (!fields.password) errors.password = "Bạn chưa điền mật khẩu.";
  else if (mode === "login" && fields.password.length > 72)
    errors.password = "Mật khẩu đang dài hơn giới hạn 72 ký tự. Hãy kiểm tra lại nội dung đã nhập.";
  if (mode === "register") {
    const name = fields.name.trim();
    if (!name || name.length > 100 || !/^[\p{L}\p{N} .'-]+$/u.test(name))
      errors.name = "Điền tên từ 1–100 ký tự; dùng chữ, số, khoảng trắng, dấu chấm, nháy hoặc gạch nối.";
    const checks = registrationPasswordChecks(fields.password);
    const unmet = checks.filter(check => !check.met).map(check => check.label);
    if (unmet.length) errors.password = `Mật khẩu chưa đáp ứng: ${unmet.join("; ")}.`;
    if (!fields.confirmation || fields.confirmation !== fields.password)
      errors.confirmation = "Hai mật khẩu chưa khớp. Hãy kiểm tra lại.";
  }
  return errors;
}
