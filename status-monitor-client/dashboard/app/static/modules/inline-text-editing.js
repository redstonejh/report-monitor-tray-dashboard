export const beginInlineTextEdit = ({
  element,
  owner = null,
  ownerEditingClass = "",
  originalText = "",
  selectAll = true,
  onCommit,
  onCancel,
  onFinish,
} = {}) => {
  if (!element || element.dataset.inlineTextEditing === "true") return null;
  const original = String(originalText || element.textContent || "").trim();
  let finished = false;

  const cleanup = () => {
    element.removeEventListener("blur", onBlur);
    element.removeEventListener("keydown", onKeydown);
    element.removeAttribute("contenteditable");
    element.removeAttribute("spellcheck");
    element.removeAttribute("role");
    element.removeAttribute("aria-multiline");
    element.classList.remove("inline-text-editing");
    delete element.dataset.inlineTextEditing;
    if (owner && ownerEditingClass) owner.classList.remove(ownerEditingClass);
  };

  const finish = (commit) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (commit) {
      onCommit?.(element.textContent || "", original);
    } else {
      element.textContent = original;
      onCancel?.(original);
    }
    onFinish?.({ committed: commit, original, value: element.textContent || "" });
  };

  const onBlur = () => finish(true);
  const onKeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  };

  element.dataset.inlineTextEditing = "true";
  element.classList.add("inline-text-editing");
  element.contentEditable = "true";
  element.spellcheck = false;
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "false");
  if (owner && ownerEditingClass) owner.classList.add(ownerEditingClass);
  element.addEventListener("blur", onBlur);
  element.addEventListener("keydown", onKeydown);
  element.focus({ preventScroll: true });
  if (selectAll) window.getSelection?.()?.selectAllChildren(element);
  return { finish };
};
