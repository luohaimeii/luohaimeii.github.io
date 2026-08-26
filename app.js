(() => {
  const API = "https://api.husir.cn";
  const FAVORITES = "husir-favorites-v1";
  const HISTORY = "husir-history-v1";
  const AUTH = "husir-reader-auth-v1";
  const read = (key, fallback = []) => { try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const api = (path, options = {}) => fetch(`${API}${path}`, { credentials: "include", ...options });
  const isSignedIn = () => localStorage.getItem(AUTH) === "1";
  const favorites = read(FAVORITES);

  document.querySelectorAll("[data-favorite]").forEach((button) => {
    const slug = button.dataset.favorite;
    const render = () => {
      const active = favorites.some((item) => item.slug === slug);
      button.classList.toggle("is-active", active);
      button.textContent = active ? "★ 已收藏" : "☆ 收藏";
    };
    render();
    button.addEventListener("click", () => {
      const index = favorites.findIndex((item) => item.slug === slug);
      if (index >= 0) favorites.splice(index, 1);
      else favorites.unshift({ slug, title: button.dataset.title, savedAt: Date.now() });
      write(FAVORITES, favorites);
      render();
      if (isSignedIn()) api("/api/bookshelf/favorites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, title: button.dataset.title, active: index < 0 }),
      }).catch(() => {});
    });
  });

  const reader = document.querySelector("[data-reader]");
  if (reader) {
    const entry = { path: location.pathname, workSlug: reader.dataset.work, workTitle: reader.dataset.workTitle, title: reader.dataset.title, readAt: Date.now() };
    const history = read(HISTORY).filter((item) => item.path !== entry.path);
    history.unshift(entry);
    write(HISTORY, history.slice(0, 100));
    if (isSignedIn()) api("/api/bookshelf/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(() => {});
    const content = document.querySelector(".reader-content");
    const size = Number(localStorage.getItem("husir-reader-size") || 20);
    if (content) content.style.fontSize = `${size}px`;
    document.querySelectorAll("[data-font]").forEach((button) => button.addEventListener("click", () => {
      if (!content) return;
      const current = Number.parseInt(content.style.fontSize || "20", 10);
      const next = Math.max(16, Math.min(30, current + Number(button.dataset.font)));
      content.style.fontSize = `${next}px`;
      localStorage.setItem("husir-reader-size", String(next));
    }));
  }

  const linkTarget = document.querySelector("#friend-links-list");
  if (linkTarget) {
    const cacheKey = "husir-friend-links-v1";
    const cache = read(cacheKey, null);
    const renderLinks = (links) => {
      if (!Array.isArray(links) || !links.length) return;
      linkTarget.replaceChildren(...links.map((link) => {
        const anchor = document.createElement("a");
        anchor.href = link.url;
        anchor.textContent = link.name;
        anchor.target = "_blank";
        anchor.rel = "noopener";
        return anchor;
      }));
    };
    if (cache?.expiresAt > Date.now()) renderLinks(cache.links);
    else api("/api/friend-links").then((response) => response.ok ? response.json() : []).then((links) => {
      renderLinks(links);
      write(cacheKey, { links, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
    }).catch(() => {});
  }

  window.HusirApi = { api, API, AUTH, FAVORITES, HISTORY, read, write };
})();
