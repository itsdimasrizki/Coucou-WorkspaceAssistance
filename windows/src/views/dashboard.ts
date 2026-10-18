// Developer Dashboard view — 4 dedicated productivity sections:
// 1. Development (GitHub, VS Code)
// 2. Productivity & Academics (Notion, Google Calendar, Google Drive)
// 3. AI Development (Claude Code, Gemini CLI, Antigravity, Codex CLI)
// 4. Trading (TradingView charts, XAUUSD analysis)

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, type CliToolInfo } from "../core/bridge";
import type { ViewActions, ViewHost } from "./views";
import { timeAgo } from "./integrations";

export function buildDashboard(actions: ViewActions): ViewHost {
  const el = h("div", { class: "view dashboard-view" });
  let activeCategory: "all" | "dev" | "productivity" | "ai" | "trading" = "all";
  let searchQuery = "";
  let selectedTradingSymbol = "OANDA:XAUUSD";

  // Header with search bar and category tabs
  const searchInput = h("input", {
    type: "text",
    class: "dash-search-input",
    placeholder: "Search tools, repos, docs, events…",
    spellcheck: "false",
    autocomplete: "off",
  }) as HTMLInputElement;

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderContent();
  });

  const catButtons: Record<string, HTMLButtonElement> = {
    all: h("button", { class: "dash-cat-btn on", text: "All" }) as HTMLButtonElement,
    dev: h("button", { class: "dash-cat-btn", text: "Development" }) as HTMLButtonElement,
    productivity: h("button", { class: "dash-cat-btn", text: "Productivity & Academics" }) as HTMLButtonElement,
    ai: h("button", { class: "dash-cat-btn", text: "AI Tools" }) as HTMLButtonElement,
    trading: h("button", { class: "dash-cat-btn", text: "Trading" }) as HTMLButtonElement,
  };

  for (const [key, btn] of Object.entries(catButtons)) {
    btn.addEventListener("click", () => {
      activeCategory = key as typeof activeCategory;
      for (const b of Object.values(catButtons)) b.classList.remove("on");
      btn.classList.add("on");
      renderContent();
    });
  }

  const categoryBar = h("div", { class: "dash-cat-bar" }, ...Object.values(catButtons));

  const searchRow = h(
    "div",
    { class: "dash-search-row" },
    h("i", { class: "dash-search-icon" }, svg(ICONS.search, 12)),
    searchInput,
  );

  const headerBox = h("div", { class: "dash-header" }, searchRow, categoryBar);
  const scrollContainer = h("div", { class: "dash-scroll" });

  el.append(headerBox, scrollContainer);

  // Helper for status badge
  function statusBadge(status: "connected" | "disconnected" | "not_configured" | "unavailable" | "error" | "installed" | "not_found", label?: string) {
    const colors = {
      connected: "#22C55E",
      installed: "#22C55E",
      disconnected: "#F5A524",
      not_configured: "#8E939C",
      not_found: "#F4505E",
      unavailable: "#6B7079",
      error: "#F4505E",
    };
    const labels = {
      connected: "Connected",
      installed: "Installed",
      disconnected: "Disconnected",
      not_configured: "Not configured",
      not_found: "Not found",
      unavailable: "Unavailable",
      error: "Error",
    };
    const text = label || labels[status] || status;
    return h(
      "span",
      { class: "dash-status-badge" },
      dot(colors[status] || "#8E939C", 5),
      h("span", { text }),
    );
  }

  function cardHeader(iconName: string, iconColor: string, title: string, category: string, badgeEl: HTMLElement, actionEl?: HTMLElement): HTMLElement {
    const head = h(
      "div",
      { class: "dash-card-head" },
      h("i", { class: "dash-card-icon", style: `color:${iconColor}` }, svg(iconName, 12)),
      h("b", { class: "dash-card-title", text: title }),
      h("span", { class: "dash-card-cat", text: category }),
      badgeEl,
    );
    if (actionEl) head.append(actionEl);
    return head;
  }

  // ── 1. Development: GitHub ──────────────────────────────────────────────────
  function renderGitHubCard(): HTMLElement {
    const info = State.integrations.integration_github;
    const configured = info?.configured ?? false;
    const error = info?.error ?? null;
    const data = (info?.data ?? {}) as Record<string, unknown>;
    const status = error ? "error" : !configured ? "not_configured" : info?.loaded ? "connected" : "unavailable";

    const badge = statusBadge(status, error ? "API Error" : !configured ? "Token required" : "Connected");

    const refreshBtn = h("button", {
      class: "dash-mini-btn",
      title: "Refresh GitHub data",
      onclick: () => void Bridge.refreshIntegration("integration_github"),
    }, svg(ICONS.refresh, 10));

    const head = cardHeader(ICONS.star, "#F4505E", "GitHub", "Development", badge, refreshBtn);

    const body = h("div", { class: "dash-card-body" });

    if (!configured) {
      body.append(
        h("div", { class: "dash-hint", text: "Configure your GitHub personal access token in Settings to view repositories, activity, and pull requests." }),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open GitHub.com",
            onclick: () => void Bridge.openUrl("https://github.com"),
          }),
          h("button", {
            class: "dash-action-btn secondary",
            text: "Configure Token…",
            onclick: () => actions.openSettingsWindow(),
          }),
        ),
      );
    } else {
      const stars = Number(data.totalStars ?? 0);
      const reposCount = Number(data.totalRepos ?? 0);

      const statsRow = h(
        "div",
        { class: "dash-stats-row" },
        h("div", { class: "dash-stat-chip" }, h("span", { class: "val", text: String(reposCount) }), h("span", { class: "lbl", text: "Repositories" })),
        h("div", { class: "dash-stat-chip" }, h("span", { class: "val", text: String(stars) }), h("span", { class: "lbl", text: "Total Stars" })),
      );
      body.append(statsRow);

      const reposList = Array.isArray(data.repos) ? (data.repos as Record<string, unknown>[]) : [];
      if (reposList.length > 0) {
        body.append(h("div", { class: "dash-section-subhead", text: "Priority & Recent Repositories" }));
        const listEl = h("div", { class: "dash-list" });
        for (const r of reposList.slice(0, 4)) {
          const repoName = String(r.name ?? "repo");
          const lang = r.language ? String(r.language) : "";
          const isPrio = Boolean(r.isPriority);
          const rStars = Number(r.stars ?? 0);
          const item = h(
            "div",
            {
              class: "dash-list-item clickable",
              onclick: () => {
                if (typeof r.url === "string") void Bridge.openUrl(r.url);
              },
            },
            h("span", { class: "dash-item-title", text: repoName }),
            isPrio ? h("span", { class: "dash-tag prio", text: "Focus" }) : null,
            lang ? h("span", { class: "dash-tag", text: lang }) : null,
            rStars > 0 ? h("span", { class: "dash-meta", text: `★ ${rStars}` }) : null,
          );
          listEl.append(item);
        }
        body.append(listListWrapper(listEl));
      }

      body.append(
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open GitHub",
            onclick: () => void Bridge.openUrl("https://github.com"),
          }),
        ),
      );
    }

    return h("div", { class: "dash-card" }, head, body);
  }

  function listListWrapper(list: HTMLElement): HTMLElement {
    return h("div", { class: "dash-list-wrap" }, list);
  }

  // ── 1. Development: Visual Studio Code ──────────────────────────────────────
  function renderVSCodeCard(): HTMLElement {
    const badge = statusBadge("installed", "Local Editor");

    const head = cardHeader(ICONS.code, "#F5F6F8", "Visual Studio Code", "Development", badge);
    const body = h("div", { class: "dash-card-body" });

    body.append(
      h("div", { class: "dash-hint", text: "Quick-launch project workspaces or terminal editor sessions directly in VS Code." }),
      h("div", { class: "dash-btn-row" },
        h("button", {
          class: "dash-action-btn primary",
          text: "Open Project in VS Code",
          onclick: () => void Bridge.openInVSCode(null),
        }),
        h("button", {
          class: "dash-action-btn secondary",
          text: "Open Web Editor (vscode.dev)",
          onclick: () => void Bridge.openUrl("https://vscode.dev"),
        }),
      ),
    );

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── 2. Productivity: Notion ─────────────────────────────────────────────────
  function renderNotionCard(): HTMLElement {
    const info = State.integrations.integration_notion;
    const configured = info?.configured ?? false;
    const error = info?.error ?? null;
    const data = (info?.data ?? {}) as Record<string, unknown>;
    const status = error ? "error" : !configured ? "not_configured" : info?.loaded ? "connected" : "unavailable";

    const badge = statusBadge(status, error ? "API Error" : !configured ? "Token required" : "Connected");

    const refreshBtn = h("button", {
      class: "dash-mini-btn",
      title: "Refresh Notion",
      onclick: () => void Bridge.refreshIntegration("integration_notion"),
    }, svg(ICONS.refresh, 10));

    const head = cardHeader(ICONS.doc, "#8C8C8C", "Notion", "Productivity & Academics", badge, refreshBtn);
    const body = h("div", { class: "dash-card-body" });

    if (!configured) {
      body.append(
        h("div", { class: "dash-hint", text: "Connect your Notion integration token in Settings to access study notes, PRDs, and task databases." }),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Notion",
            onclick: () => void Bridge.openUrl("https://notion.so"),
          }),
          h("button", {
            class: "dash-action-btn secondary",
            text: "Configure Token…",
            onclick: () => actions.openSettingsWindow(),
          }),
        ),
      );
    } else {
      const pages = Array.isArray(data.pages) ? (data.pages as Record<string, unknown>[]) : [];
      if (pages.length > 0) {
        body.append(h("div", { class: "dash-section-subhead", text: "Recent Pages & Docs" }));
        const listEl = h("div", { class: "dash-list" });
        for (const p of pages.slice(0, 3)) {
          const title = String(p.title ?? "Untitled");
          const emoji = p.emoji ? String(p.emoji) : "📄";
          const ago = timeAgo(p.lastEditedAt);
          const item = h(
            "div",
            {
              class: "dash-list-item clickable",
              onclick: () => {
                if (typeof p.url === "string") void Bridge.openUrl(p.url);
              },
            },
            h("span", { class: "dash-emoji", text: emoji }),
            h("span", { class: "dash-item-title", text: title }),
            h("span", { class: "dash-meta", text: ago }),
          );
          listEl.append(item);
        }
        body.append(listListWrapper(listEl));
      } else {
        body.append(h("div", { class: "dash-hint", text: "No recent pages found in Notion search." }));
      }

      body.append(
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Notion Workspace",
            onclick: () => void Bridge.openUrl("https://notion.so"),
          }),
        ),
      );
    }

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── 2. Productivity: Google Calendar ────────────────────────────────────────
  function renderGoogleCalendarCard(): HTMLElement {
    const info = State.integrations.integration_google_calendar;
    const configured = info?.configured ?? false;
    const error = info?.error ?? null;
    const data = (info?.data ?? {}) as Record<string, unknown>;
    const status = error ? "error" : !configured ? "not_configured" : info?.loaded ? "connected" : "unavailable";

    const badge = statusBadge(status, error ? "OAuth Error" : !configured ? "Token required" : "Connected");

    const refreshBtn = h("button", {
      class: "dash-mini-btn",
      title: "Refresh Calendar",
      onclick: () => void Bridge.refreshIntegration("integration_google_calendar"),
    }, svg(ICONS.refresh, 10));

    const head = cardHeader(ICONS.calendar, "#4285F4", "Google Calendar", "Productivity & Academics", badge, refreshBtn);
    const body = h("div", { class: "dash-card-body" });

    if (!configured) {
      body.append(
        h("div", { class: "dash-hint", text: "Connect Google Calendar with an OAuth Bearer token in Settings to view classes, deadlines, and interviews." }),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Calendar",
            onclick: () => void Bridge.openUrl("https://calendar.google.com"),
          }),
          h("button", {
            class: "dash-action-btn secondary",
            text: "Configure Token…",
            onclick: () => actions.openSettingsWindow(),
          }),
        ),
      );
    } else {
      const events = Array.isArray(data.events) ? (data.events as Record<string, unknown>[]) : [];
      if (events.length > 0) {
        body.append(h("div", { class: "dash-section-subhead", text: "Upcoming Schedule & Deadlines" }));
        const listEl = h("div", { class: "dash-list" });
        for (const ev of events.slice(0, 3)) {
          const title = String(ev.title ?? "Event");
          const start = String(ev.start ?? "");
          let timeDisplay = "";
          if (start) {
            const d = new Date(start);
            timeDisplay = !isNaN(d.getTime())
              ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : start;
          }
          const item = h(
            "div",
            {
              class: "dash-list-item clickable",
              onclick: () => {
                if (typeof ev.url === "string") void Bridge.openUrl(ev.url);
              },
            },
            dot("#4285F4", 5),
            h("span", { class: "dash-item-title", text: title }),
            timeDisplay ? h("span", { class: "dash-meta", text: timeDisplay }) : null,
          );
          listEl.append(item);
        }
        body.append(listListWrapper(listEl));
      } else {
        body.append(h("div", { class: "dash-hint", text: "No upcoming events scheduled on your primary calendar." }));
      }

      body.append(
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Google Calendar",
            onclick: () => void Bridge.openUrl("https://calendar.google.com"),
          }),
        ),
      );
    }

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── 2. Productivity: Google Drive ───────────────────────────────────────────
  function renderGoogleDriveCard(): HTMLElement {
    const info = State.integrations.integration_google_drive;
    const configured = info?.configured ?? false;
    const error = info?.error ?? null;
    const data = (info?.data ?? {}) as Record<string, unknown>;
    const status = error ? "error" : !configured ? "not_configured" : info?.loaded ? "connected" : "unavailable";

    const badge = statusBadge(status, error ? "OAuth Error" : !configured ? "Token required" : "Connected");

    const refreshBtn = h("button", {
      class: "dash-mini-btn",
      title: "Refresh Drive",
      onclick: () => void Bridge.refreshIntegration("integration_google_drive"),
    }, svg(ICONS.refresh, 10));

    const head = cardHeader(ICONS.drive, "#34A853", "Google Drive", "Productivity & Academics", badge, refreshBtn);
    const body = h("div", { class: "dash-card-body" });

    if (!configured) {
      body.append(
        h("div", { class: "dash-hint", text: "Connect Google Drive with an OAuth token in Settings to quickly access academic papers, reports, and datasets." }),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Google Drive",
            onclick: () => void Bridge.openUrl("https://drive.google.com"),
          }),
          h("button", {
            class: "dash-action-btn secondary",
            text: "Configure Token…",
            onclick: () => actions.openSettingsWindow(),
          }),
        ),
      );
    } else {
      const files = Array.isArray(data.files) ? (data.files as Record<string, unknown>[]) : [];
      if (files.length > 0) {
        body.append(h("div", { class: "dash-section-subhead", text: "Recent Academic & Project Files" }));
        const listEl = h("div", { class: "dash-list" });
        for (const f of files.slice(0, 3)) {
          const name = String(f.name ?? "Untitled");
          const size = f.size ? String(f.size) : "";
          const item = h(
            "div",
            {
              class: "dash-list-item clickable",
              onclick: () => {
                if (typeof f.url === "string") void Bridge.openUrl(f.url);
              },
            },
            h("i", { class: "dash-file-icon" }, svg(ICONS.doc, 9)),
            h("span", { class: "dash-item-title", text: name }),
            size ? h("span", { class: "dash-meta", text: size }) : null,
          );
          listEl.append(item);
        }
        body.append(listListWrapper(listEl));
      } else {
        body.append(h("div", { class: "dash-hint", text: "No recent files retrieved from Google Drive." }));
      }

      body.append(
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: "Open Google Drive",
            onclick: () => void Bridge.openUrl("https://drive.google.com"),
          }),
        ),
      );
    }

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── 3. AI Development: CLI Tools ───────────────────────────────────────────
  function renderCliToolCard(tool: CliToolInfo): HTMLElement {
    const isInstalled = tool.installed;
    const badge = statusBadge(isInstalled ? "installed" : "not_found", isInstalled ? "Installed" : "Not Found");

    const head = cardHeader(ICONS.terminal, isInstalled ? "#22C55E" : "#8E939C", tool.name, "AI Development", badge);
    const body = h("div", { class: "dash-card-body" });

    if (isInstalled) {
      body.append(
        h("div", { class: "dash-cli-info" },
          h("div", { class: "dash-cli-row" }, h("span", { class: "lbl", text: "Binary:" }), h("span", { class: "path", text: tool.path ?? tool.command })),
          tool.version ? h("div", { class: "dash-cli-row" }, h("span", { class: "lbl", text: "Version:" }), h("span", { class: "val", text: tool.version })) : null,
        ),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn primary",
            text: `Launch ${tool.name}`,
            onclick: async () => {
              const res = await Bridge.launchCliTool(tool.id, null);
              if (!res) {
                navigator.clipboard?.writeText(tool.command);
                alert(`Command '${tool.command}' copied to clipboard. Run it in your terminal.`);
              }
            },
          }),
          h("button", {
            class: "dash-action-btn secondary",
            text: "Copy Command",
            onclick: () => {
              void navigator.clipboard?.writeText(tool.command);
            },
          }),
        ),
      );
    } else {
      body.append(
        h("div", { class: "dash-cli-diagnostic", text: tool.diagnostic }),
        h("div", { class: "dash-btn-row" },
          h("button", {
            class: "dash-action-btn secondary",
            text: "Copy Install Hint",
            onclick: () => {
              void navigator.clipboard?.writeText(tool.diagnostic);
            },
          }),
        ),
      );
    }

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── 4. Trading: TradingView ────────────────────────────────────────────────
  function renderTradingViewCard(): HTMLElement {
    const badge = statusBadge("connected", "Manual Chart Access");
    const head = cardHeader(ICONS.chart, "#2962FF", "TradingView", "Trading", badge);
    const body = h("div", { class: "dash-card-body" });

    const symbols = [
      { label: "XAUUSD (Gold)", val: "OANDA:XAUUSD" },
      { label: "BTCUSD (Bitcoin)", val: "BINANCE:BTCUSDT" },
      { label: "SPX (S&P 500)", val: "SP:SPX" },
    ];

    const symbolButtons = symbols.map((s) => {
      const b = h("button", {
        class: s.val === selectedTradingSymbol ? "dash-symbol-pill on" : "dash-symbol-pill",
        text: s.label,
        onclick: () => {
          selectedTradingSymbol = s.val;
          renderContent();
        },
      });
      return b;
    });

    const symbolRow = h("div", { class: "dash-symbol-row" }, ...symbolButtons);

    const chartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(selectedTradingSymbol)}`;

    body.append(
      symbolRow,
      h("div", { class: "dash-hint", text: "Quick chart access for market analysis & price action study. Strictly for manual charting — no automated trading." }),
      h("div", { class: "dash-btn-row" },
        h("button", {
          class: "dash-action-btn primary",
          text: `Open ${selectedTradingSymbol.split(":")[1] || "Chart"} on TradingView`,
          onclick: () => void Bridge.openUrl(chartUrl),
        }),
        h("button", {
          class: "dash-action-btn secondary",
          text: "TradingView Watchlist",
          onclick: () => void Bridge.openUrl("https://www.tradingview.com/watchlists/"),
        }),
      ),
    );

    return h("div", { class: "dash-card" }, head, body);
  }

  // ── Render All Sections ────────────────────────────────────────────────────
  function renderContent() {
    clear(scrollContainer);

    const matchesSearch = (text: string) => {
      if (!searchQuery) return true;
      return text.toLowerCase().includes(searchQuery);
    };

    // 1. Development Section
    if (activeCategory === "all" || activeCategory === "dev") {
      const devCards: HTMLElement[] = [];
      if (matchesSearch("github repository code pr issue commits star")) devCards.push(renderGitHubCard());
      if (matchesSearch("vscode visual studio code workspace editor project")) devCards.push(renderVSCodeCard());

      if (devCards.length > 0) {
        scrollContainer.append(
          h("div", { class: "dash-section-title", text: "Development" }),
          h("div", { class: "dash-grid" }, ...devCards),
        );
      }
    }

    // 2. Productivity & Academics Section
    if (activeCategory === "all" || activeCategory === "productivity") {
      const prodCards: HTMLElement[] = [];
      if (matchesSearch("notion notes documentation prd study task")) prodCards.push(renderNotionCard());
      if (matchesSearch("google calendar schedule class event deadline interview")) prodCards.push(renderGoogleCalendarCard());
      if (matchesSearch("google drive documents papers research report dataset files")) prodCards.push(renderGoogleDriveCard());

      if (prodCards.length > 0) {
        scrollContainer.append(
          h("div", { class: "dash-section-title", text: "Productivity & Academics" }),
          h("div", { class: "dash-grid" }, ...prodCards),
        );
      }
    }

    // 3. AI Development Section
    if (activeCategory === "all" || activeCategory === "ai") {
      const cliCards: HTMLElement[] = [];
      const tools = State.cliTools.length > 0
        ? State.cliTools
        : [
            { id: "claude", name: "Claude Code", command: "claude", installed: false, path: null, version: null, diagnostic: "Checking…" },
            { id: "gemini", name: "Gemini CLI", command: "gemini", installed: false, path: null, version: null, diagnostic: "Checking…" },
            { id: "antigravity", name: "Google Antigravity", command: "agy", installed: false, path: null, version: null, diagnostic: "Checking…" },
            { id: "codex", name: "Codex CLI", command: "codex", installed: false, path: null, version: null, diagnostic: "Checking…" },
          ];

      for (const t of tools) {
        if (matchesSearch(`${t.name} ${t.command} ${t.path ?? ""} cli ai`)) {
          cliCards.push(renderCliToolCard(t));
        }
      }

      if (cliCards.length > 0) {
        scrollContainer.append(
          h("div", { class: "dash-section-title", text: "AI Coding CLI Tools" }),
          h("div", { class: "dash-grid" }, ...cliCards),
        );
      }
    }

    // 4. Trading Section
    if (activeCategory === "all" || activeCategory === "trading") {
      if (matchesSearch("trading tradingview xauusd gold btc spx chart analysis market")) {
        scrollContainer.append(
          h("div", { class: "dash-section-title", text: "Trading & Market Analysis" }),
          h("div", { class: "dash-grid" }, renderTradingViewCard()),
        );
      }
    }
  }

  // Initial draw
  renderContent();

  return {
    el,
    sync() {
      renderContent();
    },
  };
}
