export function initializeDashboardKeywordSearch({ scheduleOverflowTitles }) {
  const dashboardSearchForms = document.querySelectorAll(".range-search");
  const searchableItemsForPanel = (panel) => {
    const emptyStates = [...panel.querySelectorAll(".empty-state")];
    return emptyStates;
  };
  const keywordMatches = (text, terms) => {
    const haystack = String(text || "").replace(/\s+/g, " ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  };
  const applyDashboardKeywordSearch = (input) => {
    const terms = String(input?.value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    const searching = terms.length > 0;
    document.querySelectorAll(".panel-layout > .db-panel").forEach((panel) => {
      if (searching && panel.dataset.searchCollapsedBefore === undefined) {
        panel.dataset.searchCollapsedBefore = panel.classList.contains("db-panel-collapsed") ? "true" : "false";
      }
      const items = searchableItemsForPanel(panel);
      const titleText = panel.querySelector(".db-panel-title")?.textContent || "";
      const titleMatches = searching && keywordMatches(titleText, terms);
      let visibleCount = 0;
      let matchedItems = 0;
  
      if (!panel.dataset.originalPanelCount) {
        panel.dataset.originalPanelCount = panel.querySelector(".db-panel-count")?.textContent?.trim() || "";
      }
  
      if (items.length) {
        items.forEach((item) => {
          const matched = !searching || titleMatches || keywordMatches(item.textContent, terms);
          item.classList.toggle("dashboard-search-hidden", !matched);
          if (matched) matchedItems += 1;
          if (matched && !item.classList.contains("empty-state")) visibleCount += 1;
        });
      }
  
      const panelMatches = !searching || titleMatches || (items.length ? matchedItems > 0 : keywordMatches(panel.textContent, terms));
      panel.classList.toggle("dashboard-search-hidden", !panelMatches);
      if (searching && panelMatches) {
        panel.classList.remove("db-panel-collapsed");
        panel.querySelector(".db-panel-hd")?.setAttribute("aria-expanded", "true");
      } else if (!searching && panel.dataset.searchCollapsedBefore !== undefined) {
        const restoreCollapsed = panel.dataset.searchCollapsedBefore === "true";
        panel.classList.toggle("db-panel-collapsed", restoreCollapsed);
        panel.querySelector(".db-panel-hd")?.setAttribute("aria-expanded", (!restoreCollapsed).toString());
        delete panel.dataset.searchCollapsedBefore;
      }
  
      const count = panel.querySelector(".db-panel-count");
      if (count) {
        count.textContent = searching && items.length ? String(visibleCount) : panel.dataset.originalPanelCount || count.textContent;
      }
    });
    scheduleOverflowTitles();
  };
  dashboardSearchForms.forEach((form) => {
    const input = form.querySelector(".range-search-input");
    if (!input) return;
    form.dataset.keywordSearchBound = "true";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      applyDashboardKeywordSearch(input);
    });
    input.addEventListener("input", () => applyDashboardKeywordSearch(input));
    applyDashboardKeywordSearch(input);
  });

  return {
    applyDashboardKeywordSearch,
  };
}
