export const createResizeAutoZoomRuntime = () => {
  const RESIZE_AUTO_ZOOM_MIN_SCALE = 0.30;
  const RESIZE_AUTO_ZOOM_MARGIN = 22;
  const RESIZE_AUTO_ZOOM_EASE = 0.18;
  const resizeAutoZoomCamera = {
    active: false,
    frame: 0,
    scale: 1,
    targetScale: 1,
  };

  const clampResizeAutoZoomScale = (scale) => Math.max(RESIZE_AUTO_ZOOM_MIN_SCALE, Math.min(1, scale));

  const resizeAutoZoomViewport = () => {
    const navRect = document.querySelector(".app-nav")?.getBoundingClientRect?.();
    const top = Math.max(0, (navRect?.bottom || 0) + 12);
    const bottom = Math.max(top + 120, window.innerHeight - 18);
    const centerY = top + ((bottom - top) / 2);
    return {
      top,
      bottom,
      centerX: window.innerWidth / 2,
      centerY,
      height: bottom - top,
    };
  };

  const resizeAutoZoomTargetForBounds = (bounds) => {
    if (!bounds) return 1;
    const top = Number(bounds.top);
    const bottom = Number(bounds.bottom);
    const height = Number(bounds.height) || (bottom - top);
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(height) || height <= 0) return 1;
    const viewport = resizeAutoZoomViewport();
    const fitsVertically = top >= viewport.top && bottom <= viewport.bottom && height <= viewport.height;
    if (fitsVertically) return 1;
    let target = 1;
    const usableHeight = Math.max(120, viewport.height - (RESIZE_AUTO_ZOOM_MARGIN * 2));
    if (height > usableHeight) {
      target = Math.min(target, usableHeight / height);
    }
    if (bottom > viewport.bottom && bottom > viewport.centerY) {
      const denominator = bottom - viewport.centerY;
      if (denominator > 0) {
        const bottomFitScale = (viewport.bottom - RESIZE_AUTO_ZOOM_MARGIN - viewport.centerY) / denominator;
        target = Math.min(target, Math.max(RESIZE_AUTO_ZOOM_MIN_SCALE, bottomFitScale));
      }
    }
    if (top < viewport.top && top < viewport.centerY) {
      const denominator = viewport.centerY - top;
      if (denominator > 0) {
        const topFitScale = (viewport.centerY - viewport.top - RESIZE_AUTO_ZOOM_MARGIN) / denominator;
        target = Math.min(target, Math.max(RESIZE_AUTO_ZOOM_MIN_SCALE, topFitScale));
      }
    }
    return clampResizeAutoZoomScale(target);
  };

  const resizeAutoZoomElementLayoutRect = (element) => {
    if (!element) return null;
    let left = 0;
    let top = 0;
    let node = element;
    while (node && node instanceof HTMLElement) {
      left += node.offsetLeft || 0;
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return {
      left: left - (window.scrollX || 0),
      top: top - (window.scrollY || document.documentElement.scrollTop || 0),
      width: element.offsetWidth || 0,
      height: element.offsetHeight || 0,
    };
  };

  const resizeAutoZoomSceneHosts = () => [...document.querySelectorAll(".dashboard-layout-grid")];

  const resizeAutoZoomSurfaces = () => [...document.querySelectorAll(
    ".dashboard-live-resize, .dashboard-expanded-footprint-ghost"
  )].filter((surface) => !surface.classList.contains("dashboard-group-resize-footprint"));

  const applyResizeAutoZoomSceneStyles = (scale, viewport) => {
    resizeAutoZoomSceneHosts().forEach((host) => {
      const rect = resizeAutoZoomElementLayoutRect(host);
      if (!rect) return;
      const originX = Number.isFinite(rect.left) ? `${Math.round(viewport.centerX - rect.left)}px` : "50%";
      const originY = Number.isFinite(rect.top) ? `${Math.round(viewport.centerY - rect.top)}px` : "50%";
      host.style.setProperty("--resize-camera-origin-x", originX);
      host.style.setProperty("--resize-camera-origin-y", originY);
      host.style.setProperty("transform-origin", `${originX} ${originY}`, "important");
      host.style.setProperty("transform", `scale(${scale.toFixed(4)})`, "important");
    });
  };

  const applyResizeAutoZoomSurfaceStyles = () => {
    const scale = Math.max(RESIZE_AUTO_ZOOM_MIN_SCALE, Math.min(1, resizeAutoZoomCamera.scale));
    const viewport = resizeAutoZoomViewport();
    document.documentElement.style.setProperty("--resize-camera-scale", scale.toFixed(4));
    const cameraVisible = scale < 0.999 || resizeAutoZoomCamera.targetScale < 0.999;
    document.body.classList.toggle("resize-auto-zoom-active", cameraVisible);
    if (cameraVisible) {
      document.body.dataset.resizeCameraScale = scale.toFixed(4);
    } else {
      delete document.body.dataset.resizeCameraScale;
    }
    applyResizeAutoZoomSceneStyles(scale, viewport);
    resizeAutoZoomSurfaces().forEach((surface) => {
      const left = Number.parseFloat(surface.style.left);
      const top = Number.parseFloat(surface.style.top);
      const originX = Number.isFinite(left) ? `${Math.round(viewport.centerX - left)}px` : "50%";
      const originY = Number.isFinite(top) ? `${Math.round(viewport.centerY - top)}px` : "50%";
      surface.style.setProperty("transform-origin", `${originX} ${originY}`, "important");
      surface.style.setProperty("transform", `scale(${scale.toFixed(4)})`, "important");
    });
  };

  const clearResizeAutoZoomSurfaceStyles = () => {
    resizeAutoZoomSceneHosts().forEach((host) => {
      host.style.removeProperty("--resize-camera-origin-x");
      host.style.removeProperty("--resize-camera-origin-y");
      host.style.removeProperty("transform");
      host.style.removeProperty("transform-origin");
    });
    resizeAutoZoomSurfaces().forEach((surface) => {
      surface.style.removeProperty("transform");
      surface.style.removeProperty("transform-origin");
    });
  };

  const resizeAutoZoomPointerToScenePoint = (clientX, clientY) => {
    const scale = Math.max(RESIZE_AUTO_ZOOM_MIN_SCALE, Math.min(1, resizeAutoZoomCamera.scale || 1));
    if (!resizeAutoZoomCamera.active || Math.abs(scale - 1) < 0.002) {
      return { x: clientX, y: clientY };
    }
    const viewport = resizeAutoZoomViewport();
    return {
      x: viewport.centerX + ((clientX - viewport.centerX) / scale),
      y: viewport.centerY + ((clientY - viewport.centerY) / scale),
    };
  };

  const tickResizeAutoZoomCamera = () => {
    resizeAutoZoomCamera.frame = 0;
    const delta = resizeAutoZoomCamera.targetScale - resizeAutoZoomCamera.scale;
    if (Math.abs(delta) < 0.002) {
      resizeAutoZoomCamera.scale = resizeAutoZoomCamera.targetScale;
    } else {
      resizeAutoZoomCamera.scale += delta * RESIZE_AUTO_ZOOM_EASE;
    }
    applyResizeAutoZoomSurfaceStyles();
    const shouldContinue = Math.abs(resizeAutoZoomCamera.targetScale - resizeAutoZoomCamera.scale) > 0.002 ||
      Math.abs(resizeAutoZoomCamera.scale - 1) > 0.002 ||
      (resizeAutoZoomCamera.active && resizeAutoZoomCamera.targetScale < 0.999);
    if (shouldContinue) {
      resizeAutoZoomCamera.frame = requestAnimationFrame(tickResizeAutoZoomCamera);
      return;
    }
    resizeAutoZoomCamera.scale = 1;
    resizeAutoZoomCamera.targetScale = 1;
    document.documentElement.style.removeProperty("--resize-camera-scale");
    document.body.classList.remove("resize-auto-zoom-active");
    delete document.body.dataset.resizeCameraScale;
    clearResizeAutoZoomSurfaceStyles();
  };

  const ensureResizeAutoZoomFrame = () => {
    if (!resizeAutoZoomCamera.frame) {
      resizeAutoZoomCamera.frame = requestAnimationFrame(tickResizeAutoZoomCamera);
    }
  };

  const beginResizeAutoZoomCamera = () => {
    resizeAutoZoomCamera.active = true;
    resizeAutoZoomCamera.targetScale = 1;
    ensureResizeAutoZoomFrame();
  };

  const updateResizeAutoZoomCamera = (bounds) => {
    resizeAutoZoomCamera.active = true;
    resizeAutoZoomCamera.targetScale = resizeAutoZoomTargetForBounds(bounds);
    ensureResizeAutoZoomFrame();
  };

  const endResizeAutoZoomCamera = ({ immediate = false } = {}) => {
    resizeAutoZoomCamera.active = false;
    resizeAutoZoomCamera.targetScale = 1;
    if (immediate) {
      if (resizeAutoZoomCamera.frame) cancelAnimationFrame(resizeAutoZoomCamera.frame);
      resizeAutoZoomCamera.frame = 0;
      resizeAutoZoomCamera.scale = 1;
      document.documentElement.style.removeProperty("--resize-camera-scale");
      document.body.classList.remove("resize-auto-zoom-active");
      delete document.body.dataset.resizeCameraScale;
      clearResizeAutoZoomSurfaceStyles();
      return;
    }
    ensureResizeAutoZoomFrame();
  };

  return {
    beginResizeAutoZoomCamera,
    updateResizeAutoZoomCamera,
    endResizeAutoZoomCamera,
    resizeAutoZoomPointerToScenePoint,
  };
};
