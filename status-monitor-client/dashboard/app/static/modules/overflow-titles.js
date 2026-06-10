export function initializeOverflowTitles() {
  const refreshOverflowTitles = () => {
    const skipTags = new Set(["SCRIPT", "STYLE", "SVG", "PATH", "INPUT", "TEXTAREA", "SELECT", "OPTION"]);
    document.querySelectorAll("body *").forEach((element) => {
      if (skipTags.has(element.tagName)) return;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 2) return;
      const style = window.getComputedStyle(element);
      const canClip = style.textOverflow === "ellipsis" || style.overflow === "hidden" || style.whiteSpace === "nowrap";
      if (!canClip || !element.clientWidth) return;
      const clipped = element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;
      if (clipped) {
        if (!element.getAttribute("title") || element.dataset.autoTitle === "true") {
          element.setAttribute("title", text);
          element.dataset.autoTitle = "true";
        }
      } else if (element.dataset.autoTitle === "true") {
        element.removeAttribute("title");
        delete element.dataset.autoTitle;
      }
    });
  };
  
  let overflowTitleTimer;
  const scheduleOverflowTitles = () => {
    window.clearTimeout(overflowTitleTimer);
    overflowTitleTimer = window.setTimeout(refreshOverflowTitles, 80);
  };
  refreshOverflowTitles();
  window.addEventListener("load", scheduleOverflowTitles);
  window.addEventListener("resize", scheduleOverflowTitles);
  new MutationObserver(scheduleOverflowTitles).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  
  return { scheduleOverflowTitles, refreshOverflowTitles };
}
