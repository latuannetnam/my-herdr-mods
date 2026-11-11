// A lazy file browser for the focused pane's folder, with bounded read-only previews and native Markdown rendering.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window } from "herdr";
import { isMarkdownPath, boundFileText, classifyLink, probeFolderTarget } from "./helpers.js";

function location() {
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

export default class Files extends View {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.isMarkdown = false; this.viewMode = "preview"; this.rawText = null;
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, viewMode: this.viewMode });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) {
        this.viewMode = saved.viewMode || "preview";
        this.show(saved.file, cx, true);
      }
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
        if (this.file) this.reloadOpenFile(cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  applyFileText(path, text) {
    if (text === null) {
      this.code?.release(); this.code = null; this.rawText = null;
      this.fileError = "This file is no longer available";
      return true;
    }
    const bounded = boundFileText(text);
    if (bounded.binary) {
      this.code?.release(); this.code = null; this.rawText = null;
      this.fileError = "Binary file · no text preview";
      return true;
    }
    if (this.rawText === bounded.text && this.code && !this.fileError) {
      return false;
    }
    this.rawText = bounded.text;
    this.fileError = null;
    this.code?.release();
    const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
    this.code = EditorState.new({
      language: LANG[ext] ?? ext,
      readonly: true,
      value: bounded.text,
      font_family: settings().font_family,
      font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 }
    });
    return true;
  }

  show(path, cx, preserveMode = false) {
    this.code?.release(); this.code = null; this.rawText = null;
    this.file = path; this.fileError = null;
    this.isMarkdown = isMarkdownPath(path);
    if (!preserveMode) this.viewMode = "preview";
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        this.applyFileText(path, text);
      } catch {
        if (this.file === path && this.current(context)) {
          this.code?.release(); this.code = null; this.rawText = null;
          this.fileError = "Cannot preview this file (binary, too large, or unreadable)";
        }
      } finally { cx.notify(); }
    });
  }

  reloadOpenFile(cx) {
    const path = this.file, context = this.context, root = this.root, on = this.on;
    if (!path || !cx) return;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (this.applyFileText(path, text)) cx.notify();
      } catch {
        if (this.file === path && this.current(context) && !this.fileError) {
          this.code?.release(); this.code = null; this.rawText = null;
          this.fileError = "Cannot preview this file (binary, too large, or unreadable)";
          cx.notify();
        }
      }
    });
  }

  openLink(url, cx) {
    const target = classifyLink(url, this.file);
    if (target.kind === "ignore") return;
    if (target.kind === "external") {
      const platform = window()?.platform;
      if (platform === "windows") exec("rundll32", ["url.dll,FileProtocolHandler", target.url]).catch(() => null);
      else if (platform === "macos") exec("open", [target.url]).catch(() => null);
      else exec("xdg-open", [target.url]).catch(() => null);
      return;
    }
    if (target.kind === "local" && cx && this.root) {
      const context = this.context, root = this.root, on = this.on;
      cx.spawn(async cx => {
        if (!this.current(context)) return;
        const text = await readTextFile(`${root}/${target.path}`, { on }).catch(() => null);
        if (!this.current(context)) return;
        if (text !== null) {
          for (const p of target.parents) this.folders.add(p);
          this.show(target.path, cx);
          cx.notify();
          return;
        }
        const ok = await probeFolderTarget(target, this.folders, this.entries, p => this.loadFolder(p, context));
        if (ok && this.current(context)) {
          this.show(null);
          cx.notify();
        }
      });
    }
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/my-files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/my-files/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))
        .when(Boolean(this.file && this.isMarkdown && !this.fileError && this.rawText !== null), el =>
          el.child(h_flex().id("files-md-mode").flex_none().gap(2).p(2).rounded(6).bg(t.surface).border_1().border_color(t.border)
            .child(div().id("files-mode-preview").px(7).py(2).rounded(4).text_size(11).cursor_pointer()
              .bg(this.viewMode === "preview" ? t.selected : t.surface)
              .text_color(this.viewMode === "preview" ? t.foreground : t.muted)
              .hover(s => s.bg(this.viewMode === "preview" ? t.selected : t.hover))
              .on_click((_e, cx) => { this.viewMode = "preview"; cx.notify(); })
              .child("Preview"))
            .child(div().id("files-mode-raw").px(7).py(2).rounded(4).text_size(11).cursor_pointer()
              .bg(this.viewMode === "raw" ? t.selected : t.surface)
              .text_color(this.viewMode === "raw" ? t.foreground : t.muted)
              .hover(s => s.bg(this.viewMode === "raw" ? t.selected : t.hover))
              .on_click((_e, cx) => { this.viewMode = "raw"; cx.notify(); })
              .child("Raw")))))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => {
        if (this.fileError || this.rawText === null) {
          return el.child(div().p(12).text_color(t.dim).child(this.fileError || "Loading file…"));
        }
        if (this.isMarkdown && this.viewMode === "preview") {
          return el.child(v_flex().id("files-md-preview").flex_1().min_h(0).overflow_y_scrollbar().p(14)
            .child(TextView.markdown(`md-${this.file}`, this.rawText)
              .selectable(true)
              .on_link_click((url, cx) => this.openLink(url, cx))));
        }
        return el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child("Loading file…"));
      });
  }
}
