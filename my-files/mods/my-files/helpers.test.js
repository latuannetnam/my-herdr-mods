import test from "node:test";
import assert from "node:assert/strict";
import { isMarkdownPath, boundFileText, classifyLink, probeFolderTarget } from "./helpers.js";

test("isMarkdownPath detects md, markdown, mdx case-insensitively", () => {
  assert.equal(isMarkdownPath("AGENTS.md"), true);
  assert.equal(isMarkdownPath("docs/README.MARKDOWN"), true);
  assert.equal(isMarkdownPath("notes/page.mdx"), true);
  assert.equal(isMarkdownPath("main.js"), false);
  assert.equal(isMarkdownPath(null), false);
});

test("boundFileText detects binary null bytes and truncates over 400000 chars", () => {
  assert.deepEqual(boundFileText("hello\0world"), { binary: true, text: "" });
  assert.deepEqual(boundFileText("short"), { binary: false, text: "short" });
  const long = "a".repeat(400005);
  assert.deepEqual(boundFileText(long), {
    binary: false,
    text: "a".repeat(400000) + "\n… (file truncated)"
  });
});

test("classifyLink handles external URLs, anchors, malformed encoding, and parent traversal", () => {
  assert.deepEqual(classifyLink("https://gpui-kit.com/docs", "AGENTS.md"), {
    kind: "external",
    url: "https://gpui-kit.com/docs"
  });
  assert.deepEqual(classifyLink("mailto:test@example.com", "AGENTS.md"), {
    kind: "external",
    url: "mailto:test@example.com"
  });
  assert.deepEqual(classifyLink("#section-2", "AGENTS.md"), { kind: "ignore" });
  assert.deepEqual(classifyLink("../../outside.md", "docs/guide.md"), { kind: "ignore" });
  assert.deepEqual(classifyLink("./sub\\100%25-done%ZZ.md?plain=1#top", "docs/guide.md"), {
    kind: "local",
    path: "docs/sub/100%25-done%ZZ.md",
    parents: ["docs", "docs/sub"]
  });
  assert.deepEqual(classifyLink("../README.md#intro", "docs/specs/design.md"), {
    kind: "local",
    path: "docs/README.md",
    parents: ["docs"]
  });
});

test("classifyLink normalizes percent-encoded slashes and rejects encoded root traversal", () => {
  assert.deepEqual(classifyLink("%2e%2e%2foutside.md", "README.md"), { kind: "ignore" });
  assert.deepEqual(classifyLink("sub%2Fnested%5Cfile.md", "README.md"), {
    kind: "local",
    path: "sub/nested/file.md",
    parents: ["sub", "sub/nested"]
  });
});

test("probeFolderTarget rolls back newly added folders when target folder fails to load", async () => {
  const folders = new Set(["docs"]);
  const entries = new Map([["docs", [{ name: "guide.md", dir: false }]]]);
  const ok = await probeFolderTarget(
    { path: "docs/missing/dead", parents: ["docs", "docs/missing"] },
    folders,
    entries,
    async (p) => {
      if (p === "docs") return;
      throw new Error("Cannot list this folder");
    }
  );
  assert.equal(ok, false);
  assert.deepEqual([...folders], ["docs"]);
  assert.equal(entries.has("docs/missing"), false);
  assert.equal(entries.has("docs/missing/dead"), false);
});
