import test from "node:test";
import assert from "node:assert/strict";
import { registrationPasswordChecks, validateAuthFields } from "../src/adventure/authFormModel.ts";

const valid = { name: "Ngọc Kha", email: "kha@example.com", password: "Study2026!", confirmation: "Study2026!" };

test("registration explains every password requirement including the UTF-8 byte bound", () => {
  assert.equal(registrationPasswordChecks(valid.password).every(check => check.met), true);
  const longUnicode = "A1!" + "ế".repeat(24);
  assert.ok(longUnicode.length < 72);
  assert.ok(registrationPasswordChecks(longUnicode).some(check => !check.met));
  assert.match(validateAuthFields("register", { ...valid, password: longUnicode, confirmation: longUnicode }).password, /72.*byte|byte.*72/u);
});

test("registration field feedback names each unmet password rule", () => {
  const cases = [
    ["short", /8 đến 72 ký tự/u],
    ["study2026!", /chữ hoa/u],
    ["StudyOnly!", /chữ số/u],
    ["Study2026", /ký tự đặc biệt/u],
  ];
  for (const [password, unmetRule] of cases) {
    const error = validateAuthFields("register", { ...valid, password, confirmation: password }).password;
    assert.match(error, unmetRule, password);
    assert.doesNotMatch(error, /chưa đủ các điều kiện bên dưới/u);
  }
  const tooLong = "A1!" + "x".repeat(70);
  assert.equal(tooLong.length, 73);
  assert.match(validateAuthFields("register", { ...valid, password: tooLong, confirmation: tooLong }).password, /8 đến 72 ký tự/u);
});

test("password confirmation is exact and passwords are not trimmed", () => {
  assert.match(validateAuthFields("register", { ...valid, confirmation: "study2026!" }).confirmation, /khớp/);
  assert.match(validateAuthFields("register", { ...valid, confirmation: "Study2026! " }).confirmation, /khớp/);
  const withSpace = "Study2026! ";
  assert.deepEqual(validateAuthFields("register", { ...valid, password: withSpace, confirmation: withSpace }), {});
});

test("registration accepts Vietnamese names but catches invalid or empty fields", () => {
  assert.deepEqual(validateAuthFields("register", valid), {});
  assert.deepEqual(validateAuthFields("register", { ...valid, name: "  Ngọc Kha  ", email: " kha@example.com " }), {});
  assert.ok(validateAuthFields("register", { ...valid, name: "  " }).name);
  assert.ok(validateAuthFields("register", { ...valid, name: "<script>" }).name);
  assert.ok(validateAuthFields("register", { ...valid, email: "kha@" }).email);
  for (const email of ["student@school..edu", ".student@school.edu", "student..name@school.edu", "student@school.c"]) {
    assert.ok(validateAuthFields("register", { ...valid, email }).email, email);
  }
});

test("login checks only empty and over-72-character passwords", () => {
  assert.deepEqual(validateAuthFields("login", { name: "", email: valid.email, password: "abc", confirmation: "" }), {});
  assert.ok(validateAuthFields("login", { ...valid, password: "" }).password);
  assert.deepEqual(validateAuthFields("login", { ...valid, password: "x".repeat(72) }), {});
  assert.equal(
    validateAuthFields("login", { ...valid, password: "x".repeat(73) }).password,
    "Mật khẩu đang dài hơn giới hạn 72 ký tự. Hãy kiểm tra lại nội dung đã nhập.",
  );
});
