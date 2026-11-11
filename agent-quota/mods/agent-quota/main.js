import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import {
  spaces,
  agents,
  theme,
  run,
  window,
  keys,
  exec,
  shared,
  setShared,
  openOverlay,
  closeOverlay,
  props
} from "herdr";
import { PROVIDERS } from "./providers/index.js";
import { formatCountdown, mergeProviderResult, resolveActiveTab } from "./helpers.js";

export default class AgentQuota extends View {
  init(initialProps, cx) {
    this.inFlight = new Set();
    this.handle = cx.focus_handle();
    const p = initialProps ?? props() ?? {};
    this.lastPropTab = p.tab;
    this.activeTab = resolveActiveTab(p.tab, PROVIDERS);

    if (p.overlay) {
      this.handle.focus();
      const current = shared("agent.quotas") || {};
      const missing = PROVIDERS.filter(pr => !current[pr.id]?.snapshot);
      if (missing.length > 0) {
        this.refreshProviders(cx, missing);
      }
      cx.timer.every(60000, cx => cx.notify());
    } else {
      this.refreshProviders(cx, PROVIDERS);
      cx.timer.every(180000, cx => this.refreshProviders(cx, PROVIDERS));
    }
  }

  refreshProviders(cx, targets) {
    const list = targets.filter(pr => !this.inFlight.has(pr.id));
    if (list.length === 0) return;

    const before = { ...(shared("agent.quotas") || {}) };
    for (const pr of list) {
      this.inFlight.add(pr.id);
      const prev = before[pr.id];
      before[pr.id] = {
        id: pr.id,
        name: pr.name,
        shortLabel: pr.shortLabel,
        status: "loading",
        error: null,
        snapshot: prev?.snapshot ?? null
      };
    }
    setShared("agent.quotas", before);
    cx.notify();

    cx.spawn(async cx => {
      await Promise.allSettled(
        list.map(async pr => {
          let outcome;
          try {
            const r = await pr.fetchRaw(exec);
            if (r.code === 0) {
              const snapshot = pr.parse(r.stdout);
              if (snapshot) {
                outcome = { ok: true, snapshot };
              } else {
                outcome = { ok: false, error: `Invalid quota response from ${pr.id}` };
              }
            } else {
              const msg = (r.stderr || "").trim();
              outcome = { ok: false, error: msg || `${pr.id} exited with code ${r.code}` };
            }
          } catch (e) {
            outcome = { ok: false, error: String(e?.message || e) };
          } finally {
            this.inFlight.delete(pr.id);
          }

          const latest = { ...(shared("agent.quotas") || {}) };
          latest[pr.id] = mergeProviderResult(latest[pr.id], pr, outcome);
          setShared("agent.quotas", latest);
          cx.notify();
        })
      );
    });
  }

  dotColorFor(entry, pr, t) {
    const snap = entry?.snapshot;
    if (snap) {
      if (snap.level === "good") return t.done;
      if (snap.level === "warn") return t.working;
      return t.blocked;
    }
    if (this.inFlight.has(pr.id) || entry?.status === "loading") return t.working;
    if (entry?.status === "error") return t.blocked;
    return t.dim;
  }

  hint() {
    const mac = window()?.platform === "macos";
    const mod = {
      cmd: mac ? "⌘" : "Ctrl+",
      ctrl: mac ? "⌃" : "Ctrl+",
      shift: mac ? "⇧" : "Shift+",
      alt: mac ? "⌥" : "Alt+",
      option: mac ? "⌥" : "Alt+"
    };
    const b = keys().find(k => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map(p => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  renderStatusBar() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const quotas = shared("agent.quotas") || {};
    const label = (icon, text) =>
      h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);

    const pills = PROVIDERS.map(pr => {
      const entry = quotas[pr.id];
      const dotColor = this.dotColorFor(entry, pr, t);
      const loading = this.inFlight.has(pr.id) || entry?.status === "loading";
      const text = entry?.snapshot?.pillText ?? (loading ? `${pr.shortLabel} …` : `${pr.shortLabel} –`);

      return h_flex()
        .id(`quota-pill-${pr.id}`)
        .h(20)
        .px(7)
        .gap(6)
        .items_center()
        .rounded(5)
        .cursor_pointer()
        .bg(t.surface)
        .border_1()
        .border_color(t.border)
        .hover(s => s.bg(t.hover))
        .on_click(() => {
          openOverlay({
            mod: "agent-quota",
            kind: "popup",
            width: 430,
            height: 460,
            at: "pointer",
            props: { tab: pr.id }
          });
        })
        .child(div().size(6).flex_none().rounded(3).bg(dotColor))
        .child(div().flex_none().font_medium().child(text));
    });

    return h_flex()
      .size_full()
      .px(14)
      .gap(14)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().size(6).rounded(3).bg(t.dim))
          .child(`${list.length} agents`)
          .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`)))
      )
      .child(div().flex_1())
      .child(h_flex().gap(6).items_center().children(pills))
      .child(div().id("palette").cursor_pointer().text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }

  renderPopup(p) {
    const t = theme();
    const quotas = shared("agent.quotas") || {};
    const now = Date.now();

    if (p.tab && p.tab !== this.lastPropTab) {
      this.lastPropTab = p.tab;
      this.activeTab = resolveActiveTab(p.tab, PROVIDERS);
    }
    const activeTab = resolveActiveTab(this.activeTab, PROVIDERS);
    const visibleProviders = activeTab === "all" ? PROVIDERS : PROVIDERS.filter(pr => pr.id === activeTab);
    const anyRefreshing = visibleProviders.some(pr => this.inFlight.has(pr.id) || quotas[pr.id]?.status === "loading");

    const root = v_flex()
      .id("agent-quota-popup")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") {
          closeOverlay(p.overlay);
          cx.stop_propagation();
        }
      })
      .w_full()
      .bg(t.popover)
      .text_color(t.foreground);

    const header = h_flex()
      .h(38)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(div().size(8).flex_none().rounded(4).bg(t.accent))
      .child(div().flex_none().font_semibold().text_size(13).child("Agent Quotas"))
      .child(div().flex_1())
      .child(
        div()
          .id("quota-refresh")
          .flex_none()
          .px(8)
          .py(3)
          .rounded(5)
          .text_size(11)
          .cursor_pointer()
          .bg(anyRefreshing ? t.surface : t.selected)
          .text_color(anyRefreshing ? t.dim : t.foreground)
          .hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.refreshProviders(cx, visibleProviders))
          .child(anyRefreshing ? "Refreshing…" : "↻ Refresh")
      )
      .child(
        h_flex()
          .id("quota-close")
          .flex_none()
          .w(22)
          .h(22)
          .rounded(4)
          .items_center()
          .justify_center()
          .cursor_pointer()
          .text_color(t.muted)
          .hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => closeOverlay(p.overlay))
          .child("✕")
      );

    const makeTab = (id, labelText, dotColor) => {
      const selected = activeTab === id;
      return h_flex()
        .id(`quota-tab-${id}`)
        .flex_none()
        .h(22)
        .px(9)
        .gap(5)
        .items_center()
        .rounded(5)
        .cursor_pointer()
        .text_size(11)
        .bg(selected ? t.selected : t.surface)
        .text_color(selected ? t.foreground : t.muted)
        .when(selected, el => el.font_semibold())
        .hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.activeTab = id;
          cx.notify();
        })
        .when(Boolean(dotColor), el => el.child(div().size(6).flex_none().rounded(3).bg(dotColor)))
        .child(div().flex_none().child(labelText));
    };

    const tabBar = h_flex()
      .h(34)
      .flex_none()
      .px(12)
      .gap(6)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(makeTab("all", "All", null))
      .children(PROVIDERS.map(pr => makeTab(pr.id, pr.shortLabel, this.dotColorFor(quotas[pr.id], pr, t))));

    const sections = visibleProviders.map(pr => {
      const entry = quotas[pr.id];
      const snap = entry?.snapshot;
      const dotColor = this.dotColorFor(entry, pr, t);

      const providerHeader = h_flex()
        .flex_none()
        .items_center()
        .gap(6)
        .child(div().size(7).flex_none().rounded(4).bg(dotColor))
        .child(div().flex_none().font_semibold().text_size(12).child(pr.name))
        .children(
          (snap?.badges || []).map(badge => {
            const isAlert = badge === "LIMIT REACHED";
            return div()
              .flex_none()
              .px(6)
              .py(1)
              .rounded(4)
              .text_size(10)
              .font_semibold()
              .bg(t.surface)
              .border_1()
              .border_color(isAlert ? t.blocked : t.border)
              .text_color(isAlert ? t.blocked : t.accent)
              .child(badge);
          })
        )
        .child(div().flex_1())
        .when(Boolean(snap?.updatedAt), el =>
          el.child(
            div()
              .flex_none()
              .text_size(10)
              .text_color(t.dim)
              .child(`Updated ${new Date(snap.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)
          )
        );

      const section = v_flex().flex_none().gap(7).child(providerHeader);

      if (entry?.status === "error" && snap) {
        section.child(
          div()
            .flex_none()
            .text_size(10)
            .text_color(t.working)
            .child(`Refresh error (showing last data): ${entry.error}`)
        );
      }

      if (!snap) {
        if (entry?.status === "error") {
          return section.child(
            v_flex()
              .flex_none()
              .p(12)
              .gap(8)
              .rounded(8)
              .bg(t.surface)
              .border_1()
              .border_color(t.border)
              .items_center()
              .justify_center()
              .child(div().text_size(11).text_color(t.blocked).child(entry.error || `${pr.name} unavailable`))
              .child(
                div()
                  .id(`quota-retry-${pr.id}`)
                  .px(10)
                  .py(3)
                  .rounded(5)
                  .text_size(11)
                  .cursor_pointer()
                  .bg(t.selected)
                  .hover(s => s.bg(t.hover))
                  .on_click((_e, cx) => this.refreshProviders(cx, [pr]))
                  .child("Retry")
              )
          );
        }

        return section.child(
          v_flex()
            .flex_none()
            .h(72)
            .rounded(8)
            .bg(t.surface)
            .border_1()
            .border_color(t.border)
            .items_center()
            .justify_center()
            .text_size(11)
            .text_color(t.dim)
            .child(`Fetching ${pr.name} quota…`)
        );
      }

      return section.children(
        snap.groups.map(group =>
          v_flex()
            .flex_none()
            .gap(6)
            .p(10)
            .rounded(8)
            .bg(t.surface)
            .border_1()
            .border_color(t.border)
            .child(
              h_flex()
                .items_center()
                .justify_between()
                .child(div().font_semibold().text_size(12).child(group.name))
                .when(Boolean(group.subtitle), el => el.child(div().text_size(10).text_color(t.dim).child(group.subtitle)))
            )
            .children(
              group.buckets.map(bucket => {
                const levelColor = bucket.level === "good" ? t.done : bucket.level === "warn" ? t.working : t.blocked;
                const filled = Math.max(0, Math.min(100, bucket.percentage));
                const empty = 100 - filled;
                const countdown = formatCountdown(bucket.resetTime, now);

                return v_flex()
                  .flex_none()
                  .gap(4)
                  .my(2)
                  .child(
                    h_flex()
                      .justify_between()
                      .items_center()
                      .text_size(11)
                      .child(div().text_color(t.muted).child(bucket.name))
                      .child(
                        h_flex()
                          .gap(6)
                          .items_center()
                          .child(div().font_semibold().text_color(levelColor).child(`${bucket.percentage}%`))
                          .child(div().text_size(10).text_color(t.dim).child(`· ${countdown}`))
                      )
                  )
                  .child(
                    h_flex()
                      .h(6)
                      .w_full()
                      .rounded(3)
                      .bg(t.border)
                      .overflow_hidden()
                      .when(filled > 0, el => el.child(div().h_full().rounded(3).bg(levelColor).flex_grow(filled)))
                      .when(empty > 0, el => el.child(div().h_full().flex_grow(empty)))
                  );
              })
            )
        )
      );
    });

    return root
      .child(header)
      .child(tabBar)
      .child(v_flex().max_h(360).overflow_y_scrollbar().p(12).gap(12).children(sections));
  }

  render() {
    const p = props() ?? {};
    if (p.overlay) {
      return this.renderPopup(p);
    }
    return this.renderStatusBar();
  }
}
