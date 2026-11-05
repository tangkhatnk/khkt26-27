import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let React;
let renderToStaticMarkup;
let vite;
let RevisionMaterialsLibrary;

before(async () => {
  const [{ default: ReactModule }, { createServer }, { renderToStaticMarkup: render }] = await Promise.all([
    import("react"), import("vite"), import("react-dom/server"),
  ]);
  React = ReactModule;
  renderToStaticMarkup = render;
  vite = await createServer({
    configFile: resolve(projectRoot, "vite.config.ts"),
    cacheDir: resolve(projectRoot, "node_modules/.vite-revision-materials-tests"),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    ({ RevisionMaterialsLibrary } = await vite.ssrLoadModule("/src/adventure/RevisionMaterialsLibrary.tsx"));
  } catch (error) {
    if ((error?.code === "ERR_LOAD_URL" || error?.code === "ERR_MODULE_NOT_FOUND") &&
      error.message.includes("RevisionMaterialsLibrary.tsx")) return;
    throw error;
  }
});

after(async () => {
  await vite?.close();
});

const entries = [
  { id: "reviewed-id", name: "Vật lý — Năng lượng tái tạo", sourceLabel: "Tệp PDF", reviewState: "reviewed" },
  { id: "needs-review-id", name: "Lược sử khí hậu Việt Nam", sourceLabel: "Ghi chú", reviewState: "needs-review" },
  { id: "unreadable-id", name: "Tài liệu thực hành dài", sourceLabel: "Tệp DOCX", reviewState: "unreadable" },
];

const callbackProps = (overrides = {}) => ({
  entries,
  onPreview: () => {},
  onUseInPlan: () => {},
  onAddNotes: () => {},
  onAddFiles: () => {},
  onComposeWithAI: () => {},
  ...overrides,
});

function treeFor(props = callbackProps()) {
  assert.equal(typeof RevisionMaterialsLibrary, "function", "RevisionMaterialsLibrary should load with the local Vite test runtime");
  return RevisionMaterialsLibrary(props);
}

function render(entriesToRender = entries, overrides = {}) {
  assert.equal(typeof RevisionMaterialsLibrary, "function", "RevisionMaterialsLibrary should load with the local Vite test runtime");
  return renderToStaticMarkup(React.createElement(RevisionMaterialsLibrary, callbackProps({ entries: entriesToRender, ...overrides })));
}

function buttonsIn(tree, result = []) {
  if (Array.isArray(tree)) {
    for (const child of tree) buttonsIn(child, result);
  } else if (tree && typeof tree === "object" && "type" in tree) {
    if (tree.type === "button") result.push(tree);
    buttonsIn(tree.props?.children, result);
  }
  return result;
}

function buttonText(button) {
  const collect = (child) => {
    if (Array.isArray(child)) return child.map(collect).join("");
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (child && typeof child === "object" && "props" in child) return collect(child.props.children);
    return "";
  };
  return collect(button.props.children).trim();
}

test("RevisionMaterialsLibrary exports the metadata-only library component", () => {
  assert.equal(typeof RevisionMaterialsLibrary, "function");
});

test("populated library labels each review state and never renders source text or an auto-review action", () => {
  const markup = render(entries.map((entry, index) => ({
    ...entry,
    text: `SYNTHETIC_PRIVATE_SOURCE_${index}`,
  })));

  assert.match(markup, /Vật lý — Năng lượng tái tạo/u);
  assert.match(markup, /Tệp PDF/u);
  assert.match(markup, /Đã kiểm tra/u);
  assert.match(markup, /Cần kiểm tra/u);
  assert.match(markup, /Không đọc được/u);
  assert.doesNotMatch(markup, /SYNTHETIC_PRIVATE_SOURCE/u);
  assert.doesNotMatch(markup, /Đánh dấu đã kiểm tra|Xác nhận đã kiểm tra/u);
});

test("only reviewed entries can be used in a plan while every entry can open its preview", () => {
  const markup = render();
  const tree = treeFor();
  const buttons = buttonsIn(tree);
  const useButtons = buttons.filter((button) => buttonText(button) === "Dùng cho kế hoạch");
  const previewButtons = buttons.filter((button) => buttonText(button) === "Xem trước");
  const previewed = [];
  const planned = [];
  const interactiveTree = treeFor(callbackProps({
    onPreview: (id) => previewed.push(id),
    onUseInPlan: (id) => planned.push(id),
  }));
  const interactiveButtons = buttonsIn(interactiveTree);

  assert.equal(useButtons.length, 3);
  assert.equal(useButtons[0].props.disabled, false);
  assert.equal(useButtons[1].props.disabled, true);
  assert.equal(useButtons[2].props.disabled, true);
  assert.equal(previewButtons.length, 3);
  assert.match(markup, /aria-label="Xem trước: Vật lý — Năng lượng tái tạo"/u);
  interactiveButtons.find((button) => button.props["aria-label"] === "Xem trước: Lược sử khí hậu Việt Nam").props.onClick();
  interactiveButtons.find((button) => button.props["aria-label"] === "Dùng Vật lý — Năng lượng tái tạo cho kế hoạch").props.onClick();
  assert.deepEqual(previewed, ["needs-review-id"]);
  assert.deepEqual(planned, ["reviewed-id"]);
});

test("empty library offers exactly the notes, files, and AI composition actions", () => {
  const calls = [];
  const props = callbackProps({
    entries: [],
    onAddNotes: () => calls.push("notes"),
    onAddFiles: () => calls.push("files"),
    onComposeWithAI: () => calls.push("ai"),
  });
  const markup = render([], props);
  const buttons = buttonsIn(treeFor(props));

  assert.match(markup, /Chưa có tài liệu ôn tập/u);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(buttonText), ["Thêm ghi chú", "Tải tài liệu", "Nhờ AI soạn"]);
  assert.doesNotMatch(markup, /Đăng nhập|Kết nối mạng|Tài liệu mẫu|Văn bản mẫu/u);
  buttons.forEach((button) => button.props.onClick());
  assert.deepEqual(calls, ["notes", "files", "ai"]);
});

test("long Vietnamese metadata wraps on mobile and actions keep native keyboard focus", async () => {
  const longEntries = [{
    id: "long-id",
    name: "Tài liệu ôn tập về những chuyển biến kinh tế, văn hóa và xã hội ở Việt Nam trong giai đoạn đầu thế kỷ hai mươi",
    sourceLabel: "Tài liệu đã được trích xuất từ tệp PDF nhiều trang",
    reviewState: "needs-review",
  }];
  const markup = render(longEntries);
  const css = await readFile(resolve(projectRoot, "src/adventure/revisionMaterialsLibrary.css"), "utf8");

  assert.match(markup, /Tài liệu ôn tập về những chuyển biến kinh tế/u);
  assert.match(markup, /<button type="button"/u);
  assert.match(css, /@media \(max-width: 560px\)/u);
  assert.match(css, /overflow-wrap:\s*anywhere/u);
  assert.match(css, /:focus-visible\s*\{/u);
});
