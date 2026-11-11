const MAX_TEXT_CHARS = 400000;
const MD_EXT_RE = /\.(md|markdown|mdx)$/i;
const EXTERNAL_URL_RE = /^(https?:\/\/|mailto:)/i;

export function isMarkdownPath(path) {
  return typeof path === "string" && MD_EXT_RE.test(path);
}

export function boundFileText(text) {
  if (typeof text !== "string" || text.includes("\0")) {
    return { binary: true, text: "" };
  }
  if (text.length > MAX_TEXT_CHARS) {
    return { binary: false, text: text.slice(0, MAX_TEXT_CHARS) + "\n… (file truncated)" };
  }
  return { binary: false, text };
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function classifyLink(url, currentFile) {
  if (typeof url !== "string") return { kind: "ignore" };
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) return { kind: "ignore" };
  if (EXTERNAL_URL_RE.test(trimmed)) return { kind: "external", url: trimmed };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return { kind: "ignore" };

  const withoutHash = trimmed.split("#")[0].split("?")[0].replace(/\\/g, "/");
  if (!withoutHash) return { kind: "ignore" };

  const baseSegments = [];
  if (typeof currentFile === "string" && !withoutHash.startsWith("/")) {
    const cleanBase = currentFile.replace(/\\/g, "/").split("/");
    cleanBase.pop();
    for (const seg of cleanBase) {
      if (seg && seg !== ".") baseSegments.push(seg);
    }
  }

  for (const rawSeg of withoutHash.split("/")) {
    const decoded = safeDecode(rawSeg).replace(/\\/g, "/");
    for (const seg of decoded.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        if (baseSegments.length === 0) return { kind: "ignore" };
        baseSegments.pop();
      } else {
        baseSegments.push(seg);
      }
    }
  }

  if (baseSegments.length === 0) return { kind: "ignore" };

  const parents = [];
  for (let i = 1; i < baseSegments.length; i++) {
    parents.push(baseSegments.slice(0, i).join("/"));
  }

  return {
    kind: "local",
    path: baseSegments.join("/"),
    parents
  };
}

export async function probeFolderTarget(target, folders, entries, loadFolderFn) {
  const added = [];
  try {
    for (const p of [...target.parents, target.path]) {
      if (!folders.has(p)) {
        folders.add(p);
        added.push(p);
      }
      await loadFolderFn(p);
    }
    if (entries.has(target.path)) {
      return true;
    }
  } catch {
    // Fall through to rollback below
  }
  for (const p of added) {
    folders.delete(p);
    entries.delete(p);
  }
  return false;
}
