import { useState } from "react";
import { registrationPasswordChecks, validateAuthFields, type AuthFields, type AuthMode } from "./authFormModel";
import "./authForm.css";

export type AuthSubmission = { email: string; password: string; name?: string };

export function AuthForm({ busy, blocked, disableRegistration, lockedEmail, onAuthenticate, onContinue, initialMode = "login" }: {
  busy: boolean;
  blocked: boolean;
  disableRegistration: boolean;
  lockedEmail?: string;
  onAuthenticate: (value: AuthSubmission) => Promise<void>;
  onContinue: () => void;
  initialMode?: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fields, setFields] = useState<AuthFields>({ name: "", email: "", password: "", confirmation: "" });
  const [touched, setTouched] = useState<Partial<Record<keyof AuthFields, boolean>>>({});
  const [showPassword, setShowPassword] = useState(false);
  const registration = mode === "register";
  const values = { ...fields, email: lockedEmail ?? fields.email };
  const errors = validateAuthFields(mode, values);
  const disabled = busy || blocked;
  const change = (key: keyof AuthFields, value: string) => setFields(current => ({ ...current, [key]: value }));
  const blur = (key: keyof AuthFields) => setTouched(current => ({ ...current, [key]: true }));
  const fieldError = (key: keyof AuthFields) => touched[key] ? errors[key] : undefined;
  const errorText = (key: keyof AuthFields) => fieldError(key)
    ? <small className="auth-field-error" id={`auth-${key}-error`}>{fieldError(key)}</small> : null;
  function switchMode(next: AuthMode) {
    setMode(next);
    setFields(current => ({ ...current, password: "", confirmation: "" }));
    setTouched({});
    setShowPassword(false);
  }
  return <section className="panel auth-shell" aria-labelledby="auth-title">
    <div className="auth-intro">
      <span className="auth-eyebrow">TẤM VÉ CỦA RIÊNG BẠN</span>
      <div className="auth-ticket-art" aria-hidden="true"><span>VIỄN DU</span><span>✦</span><span>HỌC MỘT CHÚT<br />ĐI THẬT XA</span></div>
      <h2 id="auth-title">{lockedEmail ? "Tiếp nối hành trình." : registration ? "Chào bạn, người bạn đồng hành mới." : "Mừng bạn quay lại."}</h2>
      <p>{registration ? "Chỉ một phút để giữ lại những chặng đường đã đi và học cùng bạn bè." : "Đăng nhập để mở lại toa tàu, tài liệu và tiến độ của bạn."}</p>
      <ul className="auth-benefits"><li>Lưu tiến độ theo tài khoản</li><li>Cùng bạn bè lập đoàn tàu</li><li>Nhìn lại nhịp học của mình</li></ul>
      <button type="button" className="auth-guest-link" onClick={onContinue}>Tiếp tục khám phá ga chính →</button>
    </div>
    <form className="form auth-form" noValidate aria-busy={busy} onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      setTouched({ name: true, email: true, password: true, confirmation: true });
      const firstError = (["name", "email", "password", "confirmation"] as const).find(key => errors[key]);
      if (firstError) {
        const input = event.currentTarget.elements.namedItem(firstError);
        if (input instanceof HTMLElement) input.focus();
        return;
      }
      void onAuthenticate({ email: values.email.trim(), password: values.password, ...(registration ? { name: values.name.trim() } : {}) });
    }}>
      <div className="auth-tabs" aria-label="Cách đăng nhập">
        <button type="button" className={!registration ? "selected" : ""} aria-pressed={!registration} disabled={busy} onClick={() => switchMode("login")}>Đăng nhập</button>
        <button type="button" className={registration ? "selected" : ""} aria-pressed={registration} disabled={busy || disableRegistration} onClick={() => switchMode("register")}>Tạo tài khoản</button>
      </div>
      <div className="auth-form-heading"><h3>{registration ? "Bắt đầu hành trình của bạn" : "Mở lại hành trình"}</h3><p>{registration ? "Điền thông tin bên dưới. Bạn có thể dùng tên gọi thân quen." : "Dùng email và mật khẩu bạn đã đăng ký."}</p></div>
      {registration && <label htmlFor="auth-name">Bạn muốn được gọi là gì?
        <input id="auth-name" name="name" autoComplete="name" maxLength={100} required placeholder="Ví dụ: Ngọc Kha" disabled={disabled} value={fields.name}
          onChange={event => change("name", event.target.value)} onBlur={() => blur("name")} aria-invalid={!!fieldError("name")} aria-describedby={fieldError("name") ? "auth-name-error" : undefined} />
        {errorText("name")}
      </label>}
      <label htmlFor="auth-email">Email
        <input id="auth-email" name="email" type="email" inputMode="email" autoComplete="email" maxLength={255} required placeholder="ban@example.com" disabled={disabled} readOnly={!!lockedEmail} value={values.email}
          onChange={event => change("email", event.target.value)} onBlur={() => blur("email")} aria-invalid={!!fieldError("email")} aria-describedby={fieldError("email") ? "auth-email-error" : undefined} />
        {errorText("email")}
      </label>
      <div className="auth-password-field"><label htmlFor="auth-password">Mật khẩu</label>
        <span className="auth-password-input"><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={registration ? "new-password" : "current-password"} required
          minLength={registration ? 8 : undefined} maxLength={registration ? 72 : undefined} value={fields.password} disabled={disabled}
          onChange={event => change("password", event.target.value)} onBlur={() => blur("password")} aria-invalid={!!fieldError("password")}
          aria-describedby={[registration ? "auth-password-checks" : "", fieldError("password") ? "auth-password-error" : ""].filter(Boolean).join(" ") || undefined} />
          <button type="button" disabled={disabled} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? "Ẩn" : "Hiện"}</button>
        </span>
        {errorText("password")}
      </div>
      {registration && <>
        <ul id="auth-password-checks" className="auth-password-checks" aria-label="Điều kiện mật khẩu">
          {registrationPasswordChecks(fields.password).map(check => <li key={check.label} data-met={check.met}><span aria-hidden="true">{check.met ? "✓" : "○"}</span><span>{check.label}</span><span className="auth-sr-only">{check.met ? " — Đã đạt" : " — Chưa đạt"}</span></li>)}
        </ul>
        <label htmlFor="auth-confirmation">Nhập lại mật khẩu
          <input id="auth-confirmation" name="confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" required maxLength={72} disabled={disabled} value={fields.confirmation}
            onChange={event => change("confirmation", event.target.value)} onBlur={() => blur("confirmation")} aria-invalid={!!fieldError("confirmation")} aria-describedby={fieldError("confirmation") ? "auth-confirmation-error" : undefined} />
          {errorText("confirmation")}
        </label>
      </>}
      {blocked && <p className="auth-lock-note" role="status">Lưu phiên khách đang chạy trước khi đổi sang tài khoản. Hành trình hiện tại vẫn được giữ.</p>}
      {lockedEmail && <p className="auth-lock-note">Đăng nhập lại tài khoản này để tiếp tục đồng bộ phiên đang học.</p>}
      <button className="primary auth-submit" type="submit" disabled={disabled}>{busy ? "Đang kết nối…" : registration ? "Tạo tài khoản và lên tàu →" : "Đăng nhập →"}</button>
      <p className="auth-privacy-note">Email và mật khẩu không xuất hiện trong lịch sử chuyến đi công khai. Chi tiết dữ liệu ở ngay bên dưới.</p>
    </form>
  </section>;
}
