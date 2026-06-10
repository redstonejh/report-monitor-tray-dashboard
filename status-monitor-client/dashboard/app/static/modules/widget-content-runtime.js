export const createWidgetContentRuntime = ({ widgetRuntimeController }) => {
  const widgetInstanceFromElement = (widget, definition = widgetRuntimeController.definitionForElement(widget)) => (
    widgetRuntimeController.instanceFromElement(widget, definition)
  );
  const setWidgetRuntimeContent = (widget, html) => widgetRuntimeController.setRuntimeContent(widget, html);
  const renderWidgetRuntimeContent = (widget, options = {}) => widgetRuntimeController.renderRuntimeContent(widget, options);

  return {
    renderWidgetRuntimeContent,
    setWidgetRuntimeContent,
    widgetInstanceFromElement,
  };
};
