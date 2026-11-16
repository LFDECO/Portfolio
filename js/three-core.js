import * as THREE from "../vendor/three/three.module.min.js";
import { OrbitControls } from "../vendor/three/OrbitControls.js";

export { THREE, OrbitControls };

export const PALETTE = Object.freeze({
  paper: 0xf5f5f1,
  paperRaised: 0xfbfbf8,
  ink: 0x17191c,
  ink2: 0x4a4e55,
  ink3: 0x767a81,
  accent: 0xa4461d,
  accentLight: 0xc4622a,
  copperGlow: 0xe8a65e,
  cream: 0xf7e9c8,
});

/**
 * Return whether the user prefers reduced motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function toVec3Tuple(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  if (value && typeof value.x === "number" && typeof value.y === "number" && typeof value.z === "number") {
    return [value.x, value.y, value.z];
  }
  return fallback;
}

function renderFallback(container, message) {
  if (!container || typeof document === "undefined") {
    return () => {};
  }
  const existing = container.querySelector(".stage-fallback");
  if (existing) {
    return () => {
      if (existing.parentNode === container) container.removeChild(existing);
    };
  }
  const el = document.createElement("div");
  el.className = "stage-fallback";
  el.setAttribute("role", "status");

  const heading = document.createElement("strong");
  heading.textContent = "Interactive 3D viewport unavailable";

  const detail = document.createElement("span");
  detail.textContent = message || "WebGL rendering is unavailable or disabled in this browser.";

  el.append(heading, detail);
  container.appendChild(el);

  return () => {
    if (el.parentNode === container) container.removeChild(el);
  };
}

/**
 * Create a managed Three.js WebGL stage inside a container element.
 * Handles pixel ratio capping, ACES Filmic tone mapping, OrbitControls
 * (with page-scroll-safe zoom disabled), ResizeObserver, IntersectionObserver
 * pause/resume, manual setActive(bool), and prefers-reduced-motion handling.
 */
export function createStage(container, options = {}) {
  const opts = options ?? {};

  if (!container || typeof window === "undefined" || typeof document === "undefined") {
    return { isSupported: false, dispose: () => {} };
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
  } catch (err) {
    const cleanupFallback = renderFallback(
      container,
      "WebGL2 context could not be initialized in this environment."
    );
    return {
      isSupported: false,
      dispose: cleanupFallback,
    };
  }

  const getContainerSize = () => {
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width || container.clientWidth || 0);
    const h = Math.round(rect.height || container.clientHeight || 0);
    return { w, h };
  };

  const initialMeasure = getContainerSize();
  const initWidth = initialMeasure.w > 0 ? initialMeasure.w : 360;
  const initHeight = initialMeasure.h > 0 ? initialMeasure.h : 360;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(initWidth, initHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.toneMappingExposure ?? 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const fov = opts.fov ?? 38;
  const near = opts.near ?? 0.1;
  const far = opts.far ?? 100;
  const initialPos = toVec3Tuple(opts.cameraPos, [0, 1.8, 5.2]);
  const initialTarget = toVec3Tuple(opts.target, [0, 0, 0]);

  const camera = new THREE.PerspectiveCamera(fov, initWidth / initHeight, near, far);
  camera.position.set(initialPos[0], initialPos[1], initialPos[2]);
  camera.lookAt(initialTarget[0], initialTarget[1], initialTarget[2]);

  const desiredAutoRotate = Boolean(opts.autoRotate);
  const desiredDamping = opts.enableDamping !== false;

  let controls = null;
  if (opts.orbit !== false) {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(initialTarget[0], initialTarget[1], initialTarget[2]);
    controls.enableDamping = prefersReducedMotion() ? false : desiredDamping;
    controls.dampingFactor = opts.dampingFactor ?? 0.06;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = prefersReducedMotion() ? false : desiredAutoRotate;
    if (typeof opts.autoRotateSpeed === "number") {
      controls.autoRotateSpeed = opts.autoRotateSpeed;
    }
    if (typeof opts.minPolarAngle === "number") {
      controls.minPolarAngle = opts.minPolarAngle;
    }
    if (typeof opts.maxPolarAngle === "number") {
      controls.maxPolarAngle = opts.maxPolarAngle;
    }
    if (typeof opts.minAzimuthAngle === "number") {
      controls.minAzimuthAngle = opts.minAzimuthAngle;
    }
    if (typeof opts.maxAzimuthAngle === "number") {
      controls.maxAzimuthAngle = opts.maxAzimuthAngle;
    }
    controls.update();
    controls.saveState();
  }

  const resizeCallbacks = new Set();
  let lastReportedW = initWidth;
  let lastReportedH = initHeight;

  let isDisposed = false;
  let isActive = opts.active !== false;
  let isInViewport = true;
  let isDocumentHidden = Boolean(document.hidden);
  let loopFn = null;
  let rafId = 0;
  let singleRenderRafId = 0;
  let lastTimeMs = null;
  let elapsedSeconds = 0;

  function renderOnce(invokeLoopWithZeroDelta = false) {
    if (isDisposed) return;
    const frameBefore = renderer.info.render.frame;
    if (invokeLoopWithZeroDelta && loopFn) {
      loopFn(elapsedSeconds, 0);
    }
    if (renderer.info.render.frame === frameBefore) {
      renderer.render(scene, camera);
    }
  }

  function requestRender(invokeLoop = false) {
    if (isDisposed || !isActive || rafId) return;
    if (singleRenderRafId) return;
    singleRenderRafId = window.requestAnimationFrame(() => {
      singleRenderRafId = 0;
      if (!isDisposed && isActive) {
        renderOnce(invokeLoop);
      }
    });
  }

  function stopLoop() {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastTimeMs = null;
  }

  function tick(now) {
    rafId = 0;
    if (isDisposed || !isActive || !isInViewport || isDocumentHidden || prefersReducedMotion() || !loopFn) {
      lastTimeMs = null;
      return;
    }

    if (lastTimeMs === null) {
      lastTimeMs = now;
    }
    const rawDelta = (now - lastTimeMs) / 1000;
    lastTimeMs = now;
    const deltaSeconds = Math.min(Math.max(rawDelta, 0), 0.1);
    elapsedSeconds += deltaSeconds;

    if (controls) {
      controls.update(deltaSeconds);
    }

    const frameBefore = renderer.info.render.frame;
    loopFn(elapsedSeconds, deltaSeconds);
    if (renderer.info.render.frame === frameBefore) {
      renderer.render(scene, camera);
    }

    if (!isDisposed && isActive && isInViewport && !isDocumentHidden && !prefersReducedMotion() && loopFn) {
      rafId = window.requestAnimationFrame(tick);
    }
  }

  function syncMotionPreferences() {
    const reduced = prefersReducedMotion();
    if (controls) {
      controls.autoRotate = reduced ? false : desiredAutoRotate;
      controls.enableDamping = reduced ? false : desiredDamping;
    }
  }

  function syncLoopState() {
    if (isDisposed) return;
    syncMotionPreferences();
    const shouldAnimate =
      Boolean(loopFn) &&
      isActive &&
      isInViewport &&
      !isDocumentHidden &&
      !prefersReducedMotion();

    if (shouldAnimate) {
      if (singleRenderRafId) {
        window.cancelAnimationFrame(singleRenderRafId);
        singleRenderRafId = 0;
      }
      if (!rafId) {
        lastTimeMs = null;
        rafId = window.requestAnimationFrame(tick);
      }
    } else {
      stopLoop();
    }
  }

  function resize() {
    if (isDisposed) return false;
    const { w, h } = getContainerSize();
    if (w <= 0 || h <= 0) return false;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (renderer.getPixelRatio() !== pixelRatio) {
      renderer.setPixelRatio(pixelRatio);
    }

    const changed = w !== lastReportedW || h !== lastReportedH;
    lastReportedW = w;
    lastReportedH = h;

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    if (changed) {
      for (const cb of resizeCallbacks) {
        try {
          cb(w, h, camera.aspect);
        } catch (err) {
          console.error("[three-core] onResize callback error:", err);
        }
      }
    }

    if (isActive && isInViewport && !rafId) {
      requestRender(false);
    }
    return true;
  }

  let resizeObserver = null;
  if (typeof window.ResizeObserver === "function") {
    resizeObserver = new window.ResizeObserver(() => {
      resize();
    });
    resizeObserver.observe(container);
  }
  window.addEventListener("resize", resize, { passive: true });

  let intersectionObserver = null;
  if (typeof window.IntersectionObserver === "function") {
    intersectionObserver = new window.IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        const visible = Boolean(entry && (entry.isIntersecting || entry.intersectionRatio > 0));
        if (visible !== isInViewport) {
          isInViewport = visible;
          if (isInViewport) {
            resize();
            if (prefersReducedMotion()) {
              requestRender(false);
            }
          }
          syncLoopState();
        }
      },
      { threshold: 0 }
    );
    intersectionObserver.observe(container);
  }

  const onVisibilityChange = () => {
    isDocumentHidden = Boolean(document.hidden);
    syncLoopState();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const onMotionChange = () => {
    syncLoopState();
    if (prefersReducedMotion() && isActive && isInViewport) {
      requestRender(false);
    }
  };
  if (motionQuery && typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  }

  const onControlsChange = () => {
    if (!rafId && isActive) {
      requestRender(false);
    }
  };
  if (controls) {
    controls.addEventListener("change", onControlsChange);
  }

  const onPointerInteract = () => {
    if (prefersReducedMotion() && isActive && !rafId) {
      requestRender(false);
    }
  };
  renderer.domElement.addEventListener("pointerdown", onPointerInteract, { passive: true });
  renderer.domElement.addEventListener("pointerup", onPointerInteract, { passive: true });

  function setAnimationLoop(fn) {
    if (isDisposed) return;
    loopFn = typeof fn === "function" ? fn : null;
    if (loopFn && isActive) {
      renderOnce(true);
    }
    syncLoopState();
  }

  function setActive(active) {
    if (isDisposed) return;
    const next = Boolean(active);
    if (next === isActive) {
      if (next && !rafId) {
        resize();
        requestRender(false);
      }
      return;
    }
    isActive = next;
    if (isActive) {
      resize();
      if (prefersReducedMotion() || !loopFn) {
        requestRender(Boolean(loopFn));
      }
    } else if (singleRenderRafId) {
      window.cancelAnimationFrame(singleRenderRafId);
      singleRenderRafId = 0;
    }
    syncLoopState();
  }

  function resetCamera() {
    if (isDisposed) return;
    if (controls) {
      const prevDamping = controls.enableDamping;
      controls.enableDamping = false;
      controls.reset();
      controls.enableDamping = prefersReducedMotion() ? false : prevDamping;
    } else {
      camera.position.set(initialPos[0], initialPos[1], initialPos[2]);
      camera.lookAt(initialTarget[0], initialTarget[1], initialTarget[2]);
      camera.updateProjectionMatrix();
    }
    if (!rafId && isActive) {
      requestRender(false);
    }
  }

  function onResize(fn) {
    if (typeof fn !== "function") return () => {};
    resizeCallbacks.add(fn);
    return () => {
      resizeCallbacks.delete(fn);
    };
  }

  function dispose() {
    if (isDisposed) return;
    isDisposed = true;
    isActive = false;
    loopFn = null;

    stopLoop();
    if (singleRenderRafId) {
      window.cancelAnimationFrame(singleRenderRafId);
      singleRenderRafId = 0;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (intersectionObserver) {
      intersectionObserver.disconnect();
      intersectionObserver = null;
    }

    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    if (motionQuery && typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", onMotionChange);
    }

    renderer.domElement.removeEventListener("pointerdown", onPointerInteract);
    renderer.domElement.removeEventListener("pointerup", onPointerInteract);

    if (controls) {
      controls.removeEventListener("change", onControlsChange);
      controls.dispose();
    }

    resizeCallbacks.clear();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) {
      container.removeChild(renderer.domElement);
    }
  }

  return {
    isSupported: true,
    scene,
    camera,
    renderer,
    controls,
    setAnimationLoop,
    setActive,
    resetCamera,
    onResize,
    render: () => renderOnce(false),
    dispose,
  };
}
