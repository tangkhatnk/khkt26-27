import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path = new URL("../src/adventure/AdventureApp.tsx", import.meta.url);
const source = readFileSync(path, "utf8");
const ast = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findInitialPrompt(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "FocusFullscreenRecovery") {
    const attributes = new Map(node.attributes.properties.flatMap((property) =>
      ts.isJsxAttribute(property) ? [[property.name.getText(ast), property.initializer]] : [],
    ));
    const variant = attributes.get("variant");
    if (variant && ts.isStringLiteral(variant) && variant.text === "initial") return attributes;
  }
  let found;
  ts.forEachChild(node, (child) => { found ??= findInitialPrompt(child); });
  return found;
}

test("initial fullscreen continue dismisses only the prompt, without rerouting the active session", () => {
  const attributes = findInitialPrompt(ast);
  assert.ok(attributes, "expected the initial fullscreen failure dialog in AdventureApp");
  const dismiss = attributes.get("onDismiss");
  assert.ok(dismiss && ts.isJsxExpression(dismiss) && dismiss.expression);
  assert.equal(dismiss.expression.getText(ast), "studyFullscreen.dismissInitialPrompt");
});
