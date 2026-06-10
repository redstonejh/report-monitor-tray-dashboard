export const createDashboardFormBindings = ({
  applyDashboardKeywordSearch,
}) => {
  const bindRangeCustomControls = (root = document) => {
    root.querySelectorAll(".range-custom").forEach((form) => {
      if (form.dataset.rangeCustomBound === "true") return;
      form.dataset.rangeCustomBound = "true";
      const startInput = form.querySelector('input[name="start"]');
      const endInput = form.querySelector('input[name="end"]');
      const trigger = form.querySelector(".range-custom-trigger");
      const openPicker = (input) => {
        if (!input) return;
        if (typeof input.showPicker === "function") {
          input.showPicker();
        } else {
          input.focus();
          input.click();
        }
      };
      trigger?.addEventListener("click", () => {
        form.dataset.pickingRange = "start";
        openPicker(startInput);
      });
      startInput?.addEventListener("change", () => {
        form.dataset.pickingRange = "end";
        window.setTimeout(() => openPicker(endInput), 120);
      });
      endInput?.addEventListener("change", () => {
        const start = startInput?.value;
        const end = endInput?.value;
        if (start && end) {
          form.classList.add("range-complete");
          form.requestSubmit();
        }
      });
    });
  };

  const bindDashboardKeywordForms = (root = document) => {
    root.querySelectorAll(".range-search").forEach((form) => {
      if (form.dataset.keywordSearchBound === "true") return;
      form.dataset.keywordSearchBound = "true";
      const input = form.querySelector(".range-search-input");
      if (!input) return;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        applyDashboardKeywordSearch(input);
      });
      input.addEventListener("input", () => applyDashboardKeywordSearch(input));
      applyDashboardKeywordSearch(input);
    });
  };

  return {
    bindRangeCustomControls,
    bindDashboardKeywordForms,
  };
};
