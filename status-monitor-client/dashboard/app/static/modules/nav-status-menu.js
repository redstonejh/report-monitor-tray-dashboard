export function initializeNavStatusMenus() {
  document.querySelectorAll(".nav-status-menu").forEach((menu) => {
    let closeTimer;
    let closeAfterAnimationTimer;
    const closeMenu = (targetMenu = menu) => {
      window.clearTimeout(closeAfterAnimationTimer);
      targetMenu.classList.remove("is-open");
      closeAfterAnimationTimer = window.setTimeout(() => {
        if (!targetMenu.classList.contains("is-open")) targetMenu.open = false;
      }, 220);
    };
    const openMenu = () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(closeAfterAnimationTimer);
      document.querySelectorAll(".nav-status-menu[open]").forEach((otherMenu) => {
        if (otherMenu !== menu) {
          otherMenu.classList.remove("is-open");
          otherMenu.open = false;
        }
      });
      menu.open = true;
      menu.classList.remove("is-open");
      void menu.offsetWidth;
      window.requestAnimationFrame(() => menu.classList.add("is-open"));
    };
    const scheduleClose = () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        if (!menu.matches(":hover") && !menu.contains(document.activeElement)) closeMenu();
      }, 140);
    };
    menu.addEventListener("mouseenter", openMenu);
    menu.addEventListener("mouseleave", scheduleClose);
    menu.addEventListener("focusin", openMenu);
    menu.addEventListener("focusout", scheduleClose);
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      document.querySelectorAll(".nav-status-menu[open]").forEach((otherMenu) => {
        if (otherMenu !== menu) {
          otherMenu.classList.remove("is-open");
          otherMenu.open = false;
        }
      });
    });
  });
  
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.(".nav-status-menu")) return;
    document.querySelectorAll(".nav-status-menu[open]").forEach((menu) => {
      menu.classList.remove("is-open");
      menu.open = false;
    });
  });
}
