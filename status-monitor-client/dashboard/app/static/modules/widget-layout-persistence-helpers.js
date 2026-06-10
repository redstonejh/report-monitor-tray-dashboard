export const widgetSpacerSiblingsBefore = (widget) => {
  const spacers = [];
  let cursor = widget.previousElementSibling;
  while (cursor?.classList?.contains("widget-spacer")) {
    spacers.unshift(cursor);
    cursor = cursor.previousElementSibling;
  }
  return spacers;
};

export const widgetHasRowBreakBefore = (widget) => {
  let cursor = widget.previousElementSibling;
  while (cursor?.classList?.contains("widget-spacer")) cursor = cursor.previousElementSibling;
  return Boolean(cursor?.classList?.contains("widget-row-break"));
};
