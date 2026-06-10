(() => {
  const interactionState = window.dashboardInteractionState;

  const createPointerDragController = ({ event, item, mode = "drag" } = {}) => {
    const pointerId = event?.pointerId;
    const pointerTarget = event?.currentTarget || item;
    let interactionToken = null;
    let installed = null;

    const capturePointer = () => {
      if (pointerId == null || pointerTarget?.hasPointerCapture?.(pointerId)) return;
      try {
        pointerTarget?.setPointerCapture?.(pointerId);
      } catch {
        // Document-level listeners still cover browsers that decline capture.
      }
    };

    const releasePointer = () => {
      if (pointerId == null || !pointerTarget?.hasPointerCapture?.(pointerId)) return;
      try {
        pointerTarget.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already be released by the browser during cancel.
      }
    };

    const beginInteraction = ({ layout = null, clientX = event?.clientX, clientY = event?.clientY } = {}) => {
      if (interactionToken) return interactionToken;
      interactionToken = interactionState?.beginInteraction?.(mode, {
        pointerId,
        pointerType: event?.pointerType,
        target: pointerTarget,
        clientX,
        clientY,
      });
      if (interactionState?.state) {
        interactionState.state.activeDragState = {
          layout,
          item,
          pointerId,
          startedAt: performance.now(),
        };
      }
      return interactionToken;
    };

    const endInteraction = () => {
      if (interactionState?.state?.activeDragState?.item === item) {
        interactionState.state.activeDragState = null;
      }
      interactionToken?.end?.();
      interactionToken = null;
    };

    const removeListeners = () => {
      if (!installed) return;
      document.removeEventListener("pointermove", installed.onMove);
      document.removeEventListener("pointerup", installed.onPointerEnd);
      document.removeEventListener("pointercancel", installed.onPointerEnd);
      document.removeEventListener("keydown", installed.onKeydown);
      window.removeEventListener("blur", installed.onBlur);
      pointerTarget?.removeEventListener?.("lostpointercapture", installed.onLostPointerCapture);
      installed = null;
    };

    const install = ({ onMove, onPointerEnd, onKeydown, onBlur, onLostPointerCapture } = {}) => {
      removeListeners();
      installed = { onMove, onPointerEnd, onKeydown, onBlur, onLostPointerCapture };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onPointerEnd);
      document.addEventListener("pointercancel", onPointerEnd);
      document.addEventListener("keydown", onKeydown);
      window.addEventListener("blur", onBlur);
      pointerTarget?.addEventListener?.("lostpointercapture", onLostPointerCapture);
    };

    return {
      pointerId,
      pointerTarget,
      beginInteraction,
      capturePointer,
      endInteraction,
      install,
      releasePointer,
      removeListeners,
    };
  };

  window.dashboardDragRuntime = Object.freeze({
    createPointerDragController,
  });
})();
