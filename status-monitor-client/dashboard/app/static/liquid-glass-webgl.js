/* ── Liquid-glass WebGL overlay (prototype) ─────────────────────────────
 *
 * Single full-viewport WebGL canvas that refracts the live workspace backdrop
 * behind dashboard glass surfaces. DOM remains source of
 * truth — pointer-events: none, no interaction in WebGL.
 *
 * Shader concepts (inspired by bergice/liquidglass, not copied):
 *   - rounded-box SDF per object (constant-bound loop, multi-object min)
 *   - SDF gradient as surface normal via finite differences
 *   - edge-contour refraction weighted by exp(-|dist|·k) so distortion
 *     is strongest near edges, centers stay clear
 *   - small Gaussian blur on the refracted sample
 *   - inner-rim glow via smoothstep on signed distance
 *
 * Liquid-glass WebGL is always enabled by default.
 *   LiquidGlassWebGL.enable()          // refreshes the renderer
 *   LiquidGlassWebGL.disable()         // no-op; kept for legacy callers
 */
(() => {
  const MAX_OBJECTS = 32;
  // One glass target set for workspace objects and glass chrome. Panel-internal
  // widgets, window controls, and the floating control bar all use this same
  // full-viewport shader path.
  const OBJECT_SELECTOR = [
    ".db-panel",
    ".widget-card",
    // NOTE: the circular top-bar buttons (.window-glass-control) are intentionally
    // NOT refracted — they keep their static CSS glass only. The WebGL refraction
    // looked wrong on those small round controls.
    ".app-nav.workspace-chrome.floating-control-bar",
  ].join(", ");

  const VERT_SRC = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision mediump float;

    #define MAX_OBJECTS 32

    uniform sampler2D u_background;
    uniform vec2 u_resolution;
    uniform int u_count;
    uniform int u_debug;        // 0 = normal, 1 = mask overlay, 2 = displacement field
    uniform int u_debugObject;  // -1 = all objects, otherwise isolate index
    uniform vec4 u_rects[MAX_OBJECTS];  // x, y (top-left, css px from top-left of viewport, y-down), w, h
    uniform float u_radii[MAX_OBJECTS];

    varying vec2 v_uv;

    // Rounded-box SDF — used ONLY for the "is the pixel inside any
    // object?" hit test and for the rim/curl rendering near the
    // actual edge. NOT used for displacement direction, because its
    // interior is a flat zone of constant -r where the gradient is
    // (0,0), which produced rectangular bands at the flat-zone
    // boundary in the old single-SDF approach.
    float roundedBoxSDF(vec2 p, vec2 halfSize, float r) {
      float radius = clamp(r, 0.0, min(halfSize.x, halfSize.y));
      vec2 d = abs(p) - halfSize + vec2(radius);
      return length(max(d, 0.0)) - radius;
    }

    // Axis-aligned interior depth — linear and non-flat throughout
    // the interior. max(|p.x|-h.x, |p.y|-h.y) equals (negative)
    // distance to the nearest axis-aligned edge. No flat zone, so
    // no rectangular bands.
    float interiorDepth(vec2 p, vec2 halfSize) {
      vec2 d = abs(p) - halfSize;
      return max(d.x, d.y);
    }

    // Smooth direction toward the nearest edge, weighted by inverse
    // distance to each edge so the closer edge dominates. Continuous
    // everywhere inside the rect (no diagonal seam like a hard
    // nearest-edge selector would produce).
    vec2 edgeDirection(vec2 p, vec2 halfSize) {
      vec2 distToEdge = max(halfSize - abs(p), vec2(0.0));
      // +4.0 epsilon prevents division blow-up at the edge and gives
      // a smooth blend across the rect's interior.
      vec2 w = 1.0 / (distToEdge + vec2(4.0));
      vec2 axis = p / max(halfSize, vec2(1.0));
      vec2 dir = axis * w;
      float l = length(dir);
      float edgeGain = min(length(axis), 1.0);
      return l > 0.0001 ? (dir / l) * edgeGain : vec2(0.0);
    }

    // Texture is pre-rasterized in JS at canvas-backing size with
    // cover-fit baked in. No UV transform here.
    vec3 sampleBg(vec2 uv) {
      return texture2D(u_background, uv).rgb;
    }

    vec3 blurSample(vec2 uv) {
      vec3 sum = vec3(0.0);
      float total = 0.0;
      float sigma2 = 2.0 * 3.0;
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          vec2 off = vec2(float(x), float(y)) * 2.0 / u_resolution;
          float w = exp(-(float(x * x + y * y)) / sigma2);
          sum += sampleBg(uv + off) * w;
          total += w;
        }
      }
      return sum / total;
    }

    // Walk every object once. Accumulate a displacement vector by
    // per-object contribution:
    //   contribution = membership(px, rect) * falloff(depth) * direction
    // Returns the accumulated displacement (in CSS pixels) and the
    // minimum rounded SDF across all objects (for the outside check
    // and rim rendering). Per-object accumulation avoids the min-SDF
    // discontinuities of the old approach.
    struct Field {
      vec2 disp;
      float minRoundedDist;
    };

    Field computeField(vec2 cssPx) {
      Field f;
      f.disp = vec2(0.0);
      f.minRoundedDist = 1e6;
      for (int i = 0; i < MAX_OBJECTS; i++) {
        if (i >= u_count) break;
        if (u_debugObject >= 0 && i != u_debugObject) continue;
        vec4 r = u_rects[i];
        vec2 center = r.xy + r.zw * 0.5;
        vec2 halfSize = r.zw * 0.5;
        vec2 local = cssPx - center;
        float roundedDist = roundedBoxSDF(local, halfSize, u_radii[i]);
        f.minRoundedDist = min(f.minRoundedDist, roundedDist);
        // Smooth membership: 1 well inside, 0 well outside, smooth
        // across the rim. Removes hard transitions at object edges.
        float membership = 1.0 - smoothstep(-2.0, 2.0, roundedDist);
        if (membership < 0.001) continue;
        float depth = interiorDepth(local, halfSize);
        float falloff = exp(-abs(depth) * 0.06);
        vec2 dir = edgeDirection(local, halfSize);
        f.disp += membership * falloff * dir;
      }
      return f;
    }

    void main() {
      // v_uv is gl 0..1 with y-up. Convert to css-px with y-down (top=0).
      vec2 cssPx = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;

      Field field = computeField(cssPx);
      bool inside = field.minRoundedDist <= 1.0;
      float pushPx = 22.0;
      vec2 dispPx = -field.disp * pushPx;

      // ── Debug mode 1: mask overlay ────────────────────────────────
      if (u_debug == 1) {
        if (!inside) {
          gl_FragColor = vec4(0.0, 0.85, 1.0, 0.18);
          return;
        }
        // Visually pump displacement to make direction obvious.
        vec2 disp = dispPx * 3.0;
        vec2 refractUV = v_uv + vec2(disp.x, -disp.y) / u_resolution;
        vec3 refracted = sampleBg(refractUV);
        vec3 magentaMix = mix(refracted, vec3(1.0, 0.0, 0.8), 0.35);
        float rim2 = 1.0 - smoothstep(0.0, 6.0, -field.minRoundedDist);
        magentaMix = mix(magentaMix, vec3(1.0, 1.0, 0.0), rim2 * 0.85);
        gl_FragColor = vec4(magentaMix, 0.9);
        return;
      }

      // ── Debug mode 2: displacement field ──────────────────────────
      // Encodes the per-pixel UV displacement vector as color:
      //   R = (dispX/maxPush) * 0.5 + 0.5  (red = right push)
      //   G = (dispY/maxPush) * 0.5 + 0.5  (green = down push)
      //   B = magnitude / maxPush          (blue = strength)
      // Smooth field = smooth color gradient. Hard band = discontinuity.
      if (u_debug == 2) {
        if (!inside) {
          gl_FragColor = vec4(0.5, 0.5, 0.0, 0.25);
          return;
        }
        float maxPush = pushPx;
        vec3 col = vec3(
          (dispPx.x / maxPush) * 0.5 + 0.5,
          (dispPx.y / maxPush) * 0.5 + 0.5,
          length(dispPx) / maxPush
        );
        gl_FragColor = vec4(col, 0.95);
        return;
      }

      // ── Normal mode ───────────────────────────────────────────────
      if (!inside) {
        gl_FragColor = vec4(0.0);
        return;
      }

      // Convert px displacement to UV (note y flip: shader uv y-up).
      vec2 refractUV = v_uv + vec2(dispPx.x, -dispPx.y) / u_resolution;

      vec3 refracted = sampleBg(refractUV);
      vec3 blurred = blurSample(refractUV);
      vec3 body = mix(refracted, blurred, 0.55);

      // Slight cool-white tint to read as glass material.
      body = mix(body, vec3(0.96, 0.98, 1.0), 0.06);

      // Inner rim glow within ~6 px of the actual rim.
      float rim = 1.0 - smoothstep(0.0, 5.0, -field.minRoundedDist);
      body = mix(body, vec3(1.0), rim * 0.18);

      // Slight bottom-curl darkening, very subtle.
      float curl = smoothstep(-22.0, -2.0, field.minRoundedDist) * 0.08;
      body = mix(body, vec3(0.0), curl);

      gl_FragColor = vec4(body, 0.92);
    }
  `;

  let canvas = null;
  let gl = null;
  let program = null;
  let attribs = null;
  let uniforms = null;
  let vbo = null;
  let bgTexture = null;
  let bgImage = null;
  let bgImageSrc = "";
  let bgImageReady = false;
  let backdropReady = false;
  let offscreen = null;
  let offscreenCtx = null;
  let lastTextureKey = "";

  let rafHandle = null;
  let active = false;
  let debugMode = 0;
  let debugObjectIndex = -1;
  let pendingFrame = false;
  // One cooldown frame after the last running animation completes,
  // so the canvas captures the resting bounding boxes once the FLIP /
  // height transition has fully released.
  let animationCooldownFrames = 0;
  const ANIMATION_COOLDOWN_FRAMES = 1;
  let resizeObserver = null;
  let mutationObserver = null;
  let scrollHandler = null;
  let resizeHandler = null;

  const compileShader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("[liquid-glass-webgl] shader compile failed:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };

  const buildProgram = () => {
    const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[liquid-glass-webgl] program link failed:", gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  };

  const ensureCanvas = () => {
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.className = "liquid-glass-webgl-canvas";
    canvas.setAttribute("aria-hidden", "true");
    // Insert just after the photo backdrop so it stacks above it at z:-1.
    const photoBackdrop = document.querySelector(".workspace-photo-backdrop");
    if (photoBackdrop && photoBackdrop.parentNode) {
      photoBackdrop.parentNode.insertBefore(canvas, photoBackdrop.nextSibling);
    } else {
      document.body.insertBefore(canvas, document.body.firstChild);
    }
    gl = canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true, antialias: false });
    if (!gl) {
      console.warn("[liquid-glass-webgl] WebGL unavailable — falling back to CSS glass.");
      canvas.remove();
      canvas = null;
      return null;
    }
    program = buildProgram();
    if (!program) {
      canvas.remove();
      canvas = null;
      gl = null;
      return null;
    }
    gl.useProgram(program);
    attribs = {
      a_position: gl.getAttribLocation(program, "a_position"),
    };
    uniforms = {
      u_background: gl.getUniformLocation(program, "u_background"),
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_count: gl.getUniformLocation(program, "u_count"),
      u_debug: gl.getUniformLocation(program, "u_debug"),
      u_debugObject: gl.getUniformLocation(program, "u_debugObject"),
      u_rects: gl.getUniformLocation(program, "u_rects[0]"),
      u_radii: gl.getUniformLocation(program, "u_radii[0]"),
    };
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1,  1,
      -1,  1,  1, -1,   1,  1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.a_position);
    gl.vertexAttribPointer(attribs.a_position, 2, gl.FLOAT, false, 0, 0);
    bgTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]));
    return canvas;
  };

  const cssUrl = (value = "") => {
    const m = String(value).match(/url\(["']?([^"')]+)["']?\)/);
    return m ? m[1] : "";
  };

  const currentPhotoUrl = () => {
    // During a tone PREVIEW (hovering a colour option) the photo panel stays in the
    // DOM — background-controller only sets the backdrop's .hidden, it doesn't
    // destroy the panel until the colour is committed (clicked). Treat a hidden
    // backdrop as "no photo" so the glass clears to the previewed colour instead of
    // keeping the old photo refracted behind objects.
    const backdrop = document.querySelector(".workspace-photo-backdrop");
    if (!backdrop || backdrop.hidden) return "";
    const panel = document.querySelector(".workspace-photo-panel");
    if (!panel) return "";
    return cssUrl(panel.style.backgroundImage || getComputedStyle(panel).backgroundImage || "");
  };

  const loadBackgroundImage = () => {
    const url = currentPhotoUrl();
    if (!url) {
      if (bgImageSrc) {
        bgImage = null;
        bgImageSrc = "";
        bgImageReady = false;
        lastTextureKey = "";
      }
      return;
    }
    if (url === bgImageSrc) return;
    bgImageSrc = url;
    bgImageReady = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      bgImage = img;
      bgImageReady = true;
      lastTextureKey = "";
      rasterizeBackdropTexture();
      markDirty();
    };
    img.onerror = () => {
      console.warn("[liquid-glass-webgl] backdrop image load failed:", url);
    };
    img.src = url;
  };

  const rasterizeBackdropTexture = () => {
    if (!canvas || !gl) return;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    if (!offscreen) {
      offscreen = document.createElement("canvas");
      offscreenCtx = offscreen.getContext("2d");
    }
    if (offscreen.width !== w) offscreen.width = w;
    if (offscreen.height !== h) offscreen.height = h;

    const rootStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    const bgStart = rootStyle.getPropertyValue("--bg").trim() ||
      bodyStyle.backgroundColor ||
      "#1f2937";
    const bgEnd = rootStyle.getPropertyValue("--bg-end").trim() || bgStart;
    const photoUrl = currentPhotoUrl();
    // Re-sync whenever the photo URL changes — INCLUDING when it becomes "" (switched
    // back to a solid tone). The old guard `photoUrl && …` skipped the empty case, so
    // bgImage/bgImageReady kept the last photo and it stayed refracted behind glass
    // until a reload. loadBackgroundImage() clears that state when the URL is empty.
    if (photoUrl !== bgImageSrc) loadBackgroundImage();
    const iw = bgImageReady && bgImage ? (bgImage.naturalWidth || bgImage.width || 1) : 0;
    const ih = bgImageReady && bgImage ? (bgImage.naturalHeight || bgImage.height || 1) : 0;
    const key = `${bgStart}|${bgEnd}|${photoUrl}|${bgImageReady ? "ready" : "pending"}|${w}x${h}|${iw}x${ih}`;
    if (key === lastTextureKey) return;
    lastTextureKey = key;

    offscreenCtx.clearRect(0, 0, w, h);
    offscreenCtx.imageSmoothingEnabled = true;
    offscreenCtx.imageSmoothingQuality = "high";
    const gradient = offscreenCtx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, bgStart);
    gradient.addColorStop(1, bgEnd);
    offscreenCtx.fillStyle = gradient;
    offscreenCtx.fillRect(0, 0, w, h);

    if (bgImageReady && bgImage) {
      const imgAspect = iw / ih;
      const canvasAspect = w / h;
      let dw, dh, dx, dy;
      if (imgAspect > canvasAspect) {
        dh = h;
        dw = h * imgAspect;
        dx = (w - dw) * 0.5;
        dy = 0;
      } else {
        dw = w;
        dh = w / imgAspect;
        dx = 0;
        dy = (h - dh) * 0.5;
      }
      offscreenCtx.drawImage(bgImage, dx, dy, dw, dh);
    }
    backdropReady = true;

    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    // Flip Y so canvas top-row maps to v_uv.y=1 (shader uses y-up UVs).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    } catch (err) {
      console.warn("[liquid-glass-webgl] texImage2D failed:", err);
      backdropReady = false;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };

  // True if any glass target, or an ancestor moving glass targets, currently
  // has a running animation. The live getBoundingClientRect() loop then follows
  // FLIP, collapse, and page-slide motion through the same geometry path.
  const isAnimatingGlassTarget = () => {
    try {
      const animations = document.getAnimations?.();
      if (!animations || !animations.length) return false;
      for (const anim of animations) {
        if (anim.playState !== "running") continue;
        const target = anim.effect?.target;
        if (target?.matches?.(OBJECT_SELECTOR)) return true;
        if (target?.querySelector?.(OBJECT_SELECTOR)) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const resolveRadiusLength = (value, size) => {
    const text = String(value || "").trim();
    if (!text) return 0;
    const amount = Number.parseFloat(text);
    if (!Number.isFinite(amount)) return 0;
    if (text.endsWith("%")) return Math.max(0, amount / 100) * size;
    return Math.max(0, amount);
  };

  const resolveRadiusPair = (value, rect) => {
    const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 0;
    const horizontal = resolveRadiusLength(parts[0], rect.width);
    const vertical = resolveRadiusLength(parts[1] || parts[0], rect.height);
    return Math.min(horizontal, vertical);
  };

  const resolveGlassCornerRadius = (node, rect) => {
    const style = getComputedStyle(node);
    const maxRadius = Math.max(0, Math.min(rect.width, rect.height) * 0.5);
    const radii = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((value) => resolveRadiusPair(value, rect));
    const radius = radii.some((value) => value > 0) ? Math.max(...radii) : 14;
    return Math.min(Math.max(0, radius), maxRadius);
  };

  const collectObjects = () => {
    const nodes = document.querySelectorAll(OBJECT_SELECTOR);
    const out = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visibleClipRect = (node, rect) => {
      let left = Math.max(rect.left, 0);
      let top = Math.max(rect.top, 0);
      let right = Math.min(rect.right, vw);
      let bottom = Math.min(rect.bottom, vh);
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) <= 0.01) return null;
        const clips = /(hidden|clip|auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
        if (!clips) continue;
        const pr = parent.getBoundingClientRect();
        left = Math.max(left, pr.left);
        top = Math.max(top, pr.top);
        right = Math.min(right, pr.right);
        bottom = Math.min(bottom, pr.bottom);
        if (right - left <= 1 || bottom - top <= 1) return null;
      }
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };
    const isVisibleGlassTarget = (node, rect) => {
      if (!node.isConnected) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) <= 0.01) return false;
      const clip = visibleClipRect(node, rect);
      if (!clip || clip.width <= 4 || clip.height <= 4) return false;
      return true;
    };
    const objectTypeFor = (node) => (
      node.classList.contains("db-panel") ? "panel" :
        node.classList.contains("widget-card") ? "widget" : "chrome"
    );
    const objectKeyFor = (node) => (
      node.dataset.panelKey ||
      node.dataset.widgetKey ||
      (node.classList.contains("window-glass-control") ? "window-control" : "") ||
      (node.matches(".app-nav.workspace-chrome.floating-control-bar") ? "floating-control-bar" : "")
    );
    for (const node of nodes) {
      if (node.classList.contains("dragging")) continue;
      const r = node.getBoundingClientRect();
      if (r.width <= 4 || r.height <= 4) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
      if (!isVisibleGlassTarget(node, r)) continue;
      const radius = resolveGlassCornerRadius(node, r);
      out.push({
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        radius,
        key: objectKeyFor(node),
        type: objectTypeFor(node),
      });
      if (out.length >= MAX_OBJECTS) break;
    }
    return out;
  };

  const syncSize = () => {
    if (!canvas) return;
    // DPR capped at 1.5 — kills the upscale-blur banding that DPR=1
    // produced on Retina/HiDPI without doubling fragment-shader cost.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    let resized = false;
    if (canvas.width !== w) { canvas.width = w; resized = true; }
    if (canvas.height !== h) { canvas.height = h; resized = true; }
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    if (resized) rasterizeBackdropTexture();
  };

  const draw = () => {
    pendingFrame = false;
    if (!active || !gl || !canvas) return;

    syncSize();
    rasterizeBackdropTexture();
    if (!backdropReady) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const rects = collectObjects();
    const flatRects = new Float32Array(MAX_OBJECTS * 4);
    const flatRadii = new Float32Array(MAX_OBJECTS);
    for (let i = 0; i < rects.length; i++) {
      flatRects[i * 4 + 0] = rects[i].x;
      flatRects[i * 4 + 1] = rects[i].y;
      flatRects[i * 4 + 2] = rects[i].w;
      flatRects[i * 4 + 3] = rects[i].h;
      flatRadii[i] = rects[i].radius;
    }

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.uniform1i(uniforms.u_background, 0);
    gl.uniform2f(uniforms.u_resolution, window.innerWidth, window.innerHeight);
    gl.uniform1i(uniforms.u_count, rects.length);
    gl.uniform1i(uniforms.u_debug, debugMode | 0);
    gl.uniform1i(uniforms.u_debugObject, debugObjectIndex | 0);
    gl.uniform4fv(uniforms.u_rects, flatRects);
    gl.uniform1fv(uniforms.u_radii, flatRadii);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Live-tracking loop: while any glass-target element is animating
    // (panel collapse height transition, FLIP collision displacement),
    // re-draw every frame so the refraction follows the live
    // getBoundingClientRect() (which already reflects transforms and
    // transitioned CSS values). One cooldown frame after animations
    // settle catches the resting state. Otherwise pendingFrame stays
    // false and we revert to dirty-only mode driven by markDirty().
    if (isAnimatingGlassTarget()) {
      animationCooldownFrames = ANIMATION_COOLDOWN_FRAMES;
      pendingFrame = true;
      rafHandle = requestAnimationFrame(draw);
    } else if (animationCooldownFrames > 0) {
      animationCooldownFrames -= 1;
      pendingFrame = true;
      rafHandle = requestAnimationFrame(draw);
    }
  };

  const markDirty = () => {
    if (!active) return;
    if (pendingFrame) return;
    pendingFrame = true;
    rafHandle = requestAnimationFrame(draw);
  };

  const attachObservers = () => {
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => markDirty());
      const workspace = document.querySelector(".dashboard-layout-grid") || document.body;
      resizeObserver.observe(workspace);
    }
    if (!mutationObserver) {
      mutationObserver = new MutationObserver(() => markDirty());
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class"],
      });
    }
    if (!scrollHandler) {
      scrollHandler = () => markDirty();
      window.addEventListener("scroll", scrollHandler, { passive: true });
    }
    if (!resizeHandler) {
      resizeHandler = () => { syncSize(); markDirty(); };
      window.addEventListener("resize", resizeHandler);
    }
  };

  const detachObservers = () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
    if (scrollHandler) { window.removeEventListener("scroll", scrollHandler); scrollHandler = null; }
    if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
  };

  // User preference (persisted): the liquid-glass effect defaults OFF — only an
  // explicit "on" enables it.
  const GLASS_PREF_KEY = "dashboard-webgl-glass";
  const glassPrefEnabled = () => {
    try { return localStorage.getItem(GLASS_PREF_KEY) === "on"; } catch { return false; }
  };
  const setGlassPref = (on) => {
    try { localStorage.setItem(GLASS_PREF_KEY, on ? "on" : "off"); } catch {}
  };

  const enable = () => {
    if (active) return;
    if (!ensureCanvas()) return;
    active = true;
    if (canvas) canvas.style.display = ""; // un-hide if a prior disable() hid it
    document.body.classList.add("webgl-glass-on");
    loadBackgroundImage();
    syncSize();
    rasterizeBackdropTexture();
    attachObservers();
    // Continuous loop during drag/resize is overkill; we redraw on
    // mutation + scroll. The first frame may need to wait for the
    // texture; markDirty schedules it.
    markDirty();
  };

  // Real teardown: drop the glass body class (CSS falls back to the plain
  // surfaces), stop the render loop, detach observers, and hide the canvas so
  // no GPU work happens while the effect is off.
  const disable = () => {
    active = false;
    document.body.classList.remove("webgl-glass-on");
    detachObservers();
    if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
    pendingFrame = false;
    if (canvas) canvas.style.display = "none";
  };

  const reconcile = () => {
    if (!active) enable();
    else {
      lastTextureKey = "";
      rasterizeBackdropTexture();
      markDirty();
    }
  };

  // The menu toggle (background popover) reflects and drives the effect state.
  const syncGlassToggleButton = () => {
    const btn = document.querySelector(".glass-fx-toggle");
    if (!btn) return;
    btn.classList.toggle("is-on", active);
    btn.setAttribute("aria-pressed", String(active));
  };
  const wireGlassToggleButton = () => {
    const btn = document.querySelector(".glass-fx-toggle");
    if (!btn || btn.dataset.glassWired === "true") return;
    btn.dataset.glassWired = "true";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.LiquidGlassWebGL.toggle();
    });
    syncGlassToggleButton();
  };

  const logDiagnostics = () => {
    const canvasInfo = canvas ? {
      inDom: document.body.contains(canvas),
      cssSize: `${canvas.style.width} x ${canvas.style.height}`,
      backingSize: `${canvas.width} x ${canvas.height}`,
      computedZ: getComputedStyle(canvas).zIndex,
      computedDisplay: getComputedStyle(canvas).display,
    } : "no canvas";
    const rects = active ? collectObjects() : [];
    /* eslint-disable no-console */
    console.group("[LiquidGlassWebGL] diagnostics");
    console.log("active:", active, "debug mode:", debugMode, "debug object:", debugObjectIndex < 0 ? "all" : debugObjectIndex);
    console.log("body webgl-glass-on:", document.body.classList.contains("webgl-glass-on"));
    console.log("devicePixelRatio:", window.devicePixelRatio, "(capped at 1.5)");
    console.log("canvas:", canvasInfo);
    console.log("backdrop ready:", backdropReady, "bg image:", { src: bgImageSrc, ready: bgImageReady,
      natural: bgImage ? `${bgImage.naturalWidth}x${bgImage.naturalHeight}` : null });
    console.log("offscreen texture:", offscreen ? `${offscreen.width}x${offscreen.height}` : "none");
    console.log("collected objects:", rects.length, "(max " + MAX_OBJECTS + ")");
    if (rects.length) {
      console.table(rects.map((r, i) => ({
        index: i,
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.w),
        h: Math.round(r.h),
        radius: Math.round(r.radius),
      })));
    }
    console.log("viewport:", `${window.innerWidth}x${window.innerHeight}`);
    console.groupEnd();
    /* eslint-enable no-console */
  };

  const normalizeDebugMode = (v) => {
    if (v === true) return 1;
    if (v === false) return 0;
    const n = Number(v) | 0;
    return n < 0 ? 0 : n > 2 ? 2 : n;
  };

  window.LiquidGlassWebGL = {
    enable: () => {
      setGlassPref(true);
      reconcile();
      syncGlassToggleButton();
    },
    disable: () => {
      setGlassPref(false);
      disable();
      syncGlassToggleButton();
    },
    setEnabled: (on) => {
      const want = !!on;
      setGlassPref(want);
      if (want) reconcile(); else disable();
      syncGlassToggleButton();
    },
    toggle: () => {
      const next = !active;
      setGlassPref(next);
      if (next) reconcile(); else disable();
      syncGlassToggleButton();
      return next;
    },
    // debug(0|false) = off, debug(1|true) = mask overlay, debug(2) = UV displacement field
    debug: (mode = 1) => {
      debugMode = normalizeDebugMode(mode);
      logDiagnostics();
      markDirty();
    },
    // debugObject(i) restricts the displacement field to a single rect
    // (by collectObjects() index). debugObject(-1) or debugObject() re-
    // enables all objects. Pair with debug(2) to verify per-object
    // smoothness in isolation. The diagnostic log shows collected
    // object indices.
    debugObject: (index = -1) => {
      const n = Number(index);
      debugObjectIndex = Number.isFinite(n) ? Math.max(-1, Math.floor(n)) : -1;
      logDiagnostics();
      markDirty();
    },
    diagnostics: logDiagnostics,
    visibleObjects: () => collectObjects().map((rect) => ({ ...rect })),
    visibleObjectCount: () => collectObjects().length,
    markDirty,
    isActive: () => active,
  };

  const init = () => {
    if (glassPrefEnabled()) reconcile();
    else disable();
    wireGlassToggleButton();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
