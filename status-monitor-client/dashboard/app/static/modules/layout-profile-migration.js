export const migrateWorkingLayoutProfiles = ({ layoutPersistence }) => {
  document.querySelectorAll("[data-layout-key]").forEach((el) => {
    const layoutKey = el.dataset.layoutKey;
    if (!layoutKey) return;
    layoutPersistence.migrateActiveProfileToSingleState?.(layoutKey);
  });
};
