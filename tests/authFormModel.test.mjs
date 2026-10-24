import test from "node:test";
import assert from "node:assert/strict";
import { registrationPasswordChecks, validateAuthFields } from "../src/adventure/authFormModel.ts";

const valid = { name: "Ngọc Kha", email: "kha@example.com", password: "Study2026!", confirmation: "Study2026!" };

test("registration explains every password requirement including the UTF-8 byte bound", () => {
  assert.equal(registrationPasswordChecks(valid.password).every(check => check.met), true);
  const longUnicode = "A1!" + "ế".repeat(24);
  assert.ok(longUnicode.length < 72);
  assert.ok(registrationPasswordChecks(longUnicode).some(check => !check.met));
  assert.match(validateAuthFields("register", { ...valid, password: longUnicode, confirmation: longUnicode }).password, /dài|72/);
  for (const password of ["short", "study2026!", "StudyOnly!", "Study2026"]) {
    assert.ok(validateAuthFields("register", { ...valid, password, confirmation: password }).password);
  }
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

test("login does not impose new registration requirements on existing passwords", () => {
  assert.deepEqual(validateAuthFields("login", { name: "", email: valid.email, password: "abc", confirmation: "" }), {});
  assert.ok(validateAuthFields("login", { ...valid, password: "" }).password);
});
