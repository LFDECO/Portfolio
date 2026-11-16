import { THREE, PALETTE, createStage, prefersReducedMotion } from "./three-core.js";

/**
 * Hero 3D centerpiece for Siddhartha Bhaduri's portfolio.
 * Precision-instrument computational sculpture bridging first-principles
 * systems architecture with non-visible spectral imaging.
 */
(() => {
  const container = document.getElementById("hero-3d");
  if (!container) return;

  const wrap = document.getElementById("hero-3d-wrap") || container.closest(".hero-stage");
  const readoutEl = document.getElementById("hero-readout");
  const modeButtons = wrap ? [...wrap.querySelectorAll("[data-hero-mode]")] : [];

  const DEFAULT_CAM_POS = [0.35, 1.38, 5.42];
  const DEFAULT_TARGET = [0, 0.04, 0];

  const MODE_READOUT = Object.freeze({
    orbit: "Interactive 3D · drag to orbit",
    explode: "Layers · 4 shells separated",
    reset: "View reset · drag to orbit",
  });

  const LAYER_READOUT = Object.freeze({
    core: "Core · faceted polymer nucleus",
    lattice: "Lattice · geodesic node array",
    "ring-350": "Ring 01 · 350 GHz THz band",
    "ring-500": "Ring 02 · 500 GHz THz band",
    "ring-swir": "Ring 03 · 13-band SWIR orbit",
    grid: "Datum · 46×46 reference grid",
  });

  const stage = createStage(container, {
    fov: 36,
    cameraPos: DEFAULT_CAM_POS,
    target: DEFAULT_TARGET,
    orbit: true,
    autoRotate: false,
    enableDamping: true,
    dampingFactor: 0.06,
    minPolarAngle: Math.PI * 0.14,
    maxPolarAngle: Math.PI * 0.72,
    toneMappingExposure: 1.05,
  });

  function setReadout(text) {
    if (readoutEl && readoutEl.textContent !== text) {
      readoutEl.textContent = text;
    }
  }

  if (!stage.isSupported) {
    setReadout("3D unavailable · static frame");
    for (const btn of modeButtons) {
      btn.disabled = true;
    }
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) stage.dispose();
    });
    return;
  }

  const { scene, camera, renderer, controls } = stage;
  const disposables = { textures: [], envRT: null };

  /**
   * Build a clean procedural studio light-box environment map so
   * metallic copper rings and clearcoat crystal facets catch crisp speculars.
   */
  function buildStudioEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();

      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x090b0d);

      const panelGeo = new THREE.PlaneGeometry(1, 1);
      const mats = [];

      const addPanel = (color, intensity, pos, scale, lookAt) => {
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.DoubleSide,
        });
        mats.push(mat);
        const mesh = new THREE.Mesh(panelGeo, mat);
        mesh.position.set(pos[0], pos[1], pos[2]);
        mesh.scale.set(scale[0], scale[1], 1);
        mesh.lookAt(lookAt[0], lookAt[1], lookAt[2]);
        envScene.add(mesh);
      };

      // Warm overhead softbox, copper rim card, neutral graphite studio fill
      addPanel(PALETTE.cream, 3.1, [4.5, 5.5, 4.0], [5.5, 4.0], [0, 0, 0]);
      addPanel(PALETTE.copperGlow, 3.0, [-5.5, 2.2, -3.5], [5.0, 4.2], [0, 0, 0]);
      addPanel(0x98a8bc, 1.75, [-4.8, -1.0, 4.2], [4.5, 4.0], [0, 0, 0]);
      addPanel(PALETTE.accentLight, 2.0, [3.2, -3.5, -4.2], [4.0, 3.0], [0, 0, 0]);

      const envRT = pmrem.fromScene(envScene, 0.04);
      panelGeo.dispose();
      for (const m of mats) m.dispose();
      pmrem.dispose();

      disposables.envRT = envRT;
      scene.environment = envRT.texture;
    } catch {
      // Non-fatal: direct scene lights still illuminate the sculpture cleanly.
    }
  }

  /** Soft circular radial sprite texture for anti-aliased point nodes. */
  function createPointSpriteTexture() {
    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    grad.addColorStop(0.35, "rgba(255, 255, 255, 0.85)");
    grad.addColorStop(0.7, "rgba(255, 255, 255, 0.22)");
    grad.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    disposables.textures.push(tex);
    return tex;
  }

  /** Subtle radial copper under-glow disc for anchoring the datum plane. */
  function createDatumGlowTexture() {
    const size = 128;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 2, half, half, half);
    grad.addColorStop(0.0, "rgba(232, 166, 94, 0.28)");
    grad.addColorStop(0.45, "rgba(164, 70, 29, 0.11)");
    grad.addColorStop(1.0, "rgba(9, 11, 13, 0.0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    disposables.textures.push(tex);
    return tex;
  }

  /** Deterministic PRNG for reproducible node placement. */
  function createRng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Extract deduplicated spatial vertices from a BufferGeometry. */
  function getUniqueVertices(geometry) {
    const pos = geometry.attributes.position;
    const seen = new Set();
    const unique = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(new THREE.Vector3(x, y, z));
      }
    }
    return unique;
  }

  function tagLayer(object, layerKey) {
    object.userData.layerKey = layerKey;
    object.traverse((child) => {
      child.userData.layerKey = layerKey;
    });
  }

  // --- Studio Lighting ---
  buildStudioEnvironment();

  const hemiLight = new THREE.HemisphereLight(0xdce2ec, 0x0d0f12, 0.48);
  scene.add(hemiLight);

  const keyLight = new THREE.DirectionalLight(PALETTE.cream, 2.45);
  keyLight.position.set(3.8, 5.2, 4.2);
  scene.add(keyLight);

  const copperRimLight = new THREE.DirectionalLight(PALETTE.copperGlow, 2.4);
  copperRimLight.position.set(-4.5, 2.4, -3.6);
  scene.add(copperRimLight);

  const coolFillLight = new THREE.DirectionalLight(0x98a6b8, 0.95);
  coolFillLight.position.set(-3.6, -0.6, 3.4);
  scene.add(coolFillLight);

  const corePointLight = new THREE.PointLight(PALETTE.accentLight, 4.2, 7.0, 1.6);
  corePointLight.position.set(0, 0.24, 0);
  scene.add(corePointLight);

  // --- Root Groups ---
  const rootGroup = new THREE.Group();
  scene.add(rootGroup);

  const parallaxGroup = new THREE.Group();
  rootGroup.add(parallaxGroup);

  const assemblyGroup = new THREE.Group();
  assemblyGroup.position.set(0, 0.24, 0);
  parallaxGroup.add(assemblyGroup);

  // Highlightable materials map keyed by layerKey
  const layerEmissives = {
    core: [],
    lattice: [],
    "ring-350": [],
    "ring-500": [],
    "ring-swir": [],
    grid: [],
  };

  function registerHighlightMaterial(layerKey, material, baseEmissiveIntensity) {
    layerEmissives[layerKey].push({
      material,
      base: baseEmissiveIntensity,
    });
  }

  // =========================================================================
  // 1. INNER FACETED CRYSTAL / POLYMER CORE
  // =========================================================================
  const coreGroup = new THREE.Group();
  assemblyGroup.add(coreGroup);

  // Bright central computational nucleus
  const nucleusGeo = new THREE.OctahedronGeometry(0.21, 0);
  const nucleusMat = new THREE.MeshPhysicalMaterial({
    color: PALETTE.copperGlow,
    emissive: PALETTE.accentLight,
    emissiveIntensity: 0.78,
    metalness: 0.55,
    roughness: 0.18,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    flatShading: true,
  });
  const nucleusMesh = new THREE.Mesh(nucleusGeo, nucleusMat);
  coreGroup.add(nucleusMesh);
  registerHighlightMaterial("core", nucleusMat, 0.78);

  const nucleusEdgeGeo = new THREE.EdgesGeometry(nucleusGeo);
  const nucleusEdgeMat = new THREE.LineBasicMaterial({
    color: PALETTE.cream,
    transparent: true,
    opacity: 0.72,
  });
  nucleusMesh.add(new THREE.LineSegments(nucleusEdgeGeo, nucleusEdgeMat));

  // Outer translucent faceted crystal polymer shell
  const crystalShellGroup = new THREE.Group();
  coreGroup.add(crystalShellGroup);

  const crystalGeo = new THREE.IcosahedronGeometry(0.47, 0);
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x5d311d,
    emissive: PALETTE.accent,
    emissiveIntensity: 0.12,
    metalness: 0.08,
    roughness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    ior: 1.62,
    reflectivity: 0.95,
    iridescence: 0.32,
    sheen: 0.45,
    sheenColor: new THREE.Color(PALETTE.copperGlow),
    envMapIntensity: 1.7,
    transparent: true,
    opacity: 0.56,
    flatShading: true,
    depthWrite: false,
  });
  const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
  crystalShellGroup.add(crystalMesh);
  registerHighlightMaterial("core", crystalMat, 0.12);

  const crystalEdgeGeo = new THREE.EdgesGeometry(crystalGeo);
  const crystalEdgeMat = new THREE.LineBasicMaterial({
    color: PALETTE.copperGlow,
    transparent: true,
    opacity: 0.55,
  });
  crystalShellGroup.add(new THREE.LineSegments(crystalEdgeGeo, crystalEdgeMat));

  // Machined polar calibration collars capping the core axis
  const collarMat = new THREE.MeshStandardMaterial({
    color: PALETTE.cream,
    emissive: PALETTE.accent,
    emissiveIntensity: 0.22,
    metalness: 0.82,
    roughness: 0.26,
  });
  registerHighlightMaterial("core", collarMat, 0.22);

  const collarGeo = new THREE.TorusGeometry(0.24, 0.014, 12, 48);
  const topCollar = new THREE.Mesh(collarGeo, collarMat);
  topCollar.rotation.x = Math.PI / 2;
  topCollar.position.y = 0.44;
  coreGroup.add(topCollar);

  const bottomCollar = new THREE.Mesh(collarGeo, collarMat);
  bottomCollar.rotation.x = Math.PI / 2;
  bottomCollar.position.y = -0.44;
  coreGroup.add(bottomCollar);

  tagLayer(coreGroup, "core");

  // =========================================================================
  // 2. GEODESIC WIREFRAME LATTICE & VOLUMETRIC POINT CLOUD
  // =========================================================================
  const latticeGroup = new THREE.Group();
  assemblyGroup.add(latticeGroup);

  // Inner graphite geodesic frame
  const innerLatticeGroup = new THREE.Group();
  latticeGroup.add(innerLatticeGroup);

  const innerGeo = new THREE.IcosahedronGeometry(0.74, 1);
  const innerEdges = new THREE.EdgesGeometry(innerGeo, 1);
  innerGeo.dispose();
  const innerWireMat = new THREE.LineBasicMaterial({
    color: 0x7b8898,
    transparent: true,
    opacity: 0.48,
  });
  innerLatticeGroup.add(new THREE.LineSegments(innerEdges, innerWireMat));

  // Outer copper geodesic frame
  const outerLatticeGroup = new THREE.Group();
  latticeGroup.add(outerLatticeGroup);

  const outerGeo = new THREE.IcosahedronGeometry(0.96, 1);
  const outerEdges = new THREE.EdgesGeometry(outerGeo, 1);
  const outerWireMat = new THREE.LineBasicMaterial({
    color: PALETTE.copperGlow,
    transparent: true,
    opacity: 0.64,
  });
  outerLatticeGroup.add(new THREE.LineSegments(outerEdges, outerWireMat));

  // Precision octahedral pins at every unique vertex of the outer geodesic cage
  const uniqueOuterVerts = getUniqueVertices(outerGeo);
  outerGeo.dispose();

  const pinGeo = new THREE.OctahedronGeometry(0.025, 0);
  const pinMat = new THREE.MeshStandardMaterial({
    color: PALETTE.cream,
    emissive: PALETTE.copperGlow,
    emissiveIntensity: 0.38,
    metalness: 0.85,
    roughness: 0.22,
  });
  registerHighlightMaterial("lattice", pinMat, 0.38);

  const pinInstances = new THREE.InstancedMesh(pinGeo, pinMat, uniqueOuterVerts.length);
  const dummy = new THREE.Object3D();
  uniqueOuterVerts.forEach((v, idx) => {
    dummy.position.copy(v);
    dummy.lookAt(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    pinInstances.setMatrixAt(idx, dummy.matrix);
  });
  pinInstances.instanceMatrix.needsUpdate = true;
  outerLatticeGroup.add(pinInstances);

  // Volumetric inner point-cloud nodes (deterministic Fibonacci spherical shells)
  const pointCloudGroup = new THREE.Group();
  latticeGroup.add(pointCloudGroup);

  const rng = createRng(2910);
  const pointCount = 168;
  const pointPositions = new Float32Array(pointCount * 3);
  const pointColors = new Float32Array(pointCount * 3);
  const basePointPositions = new Float32Array(pointCount * 3);
  const pointPhases = new Float32Array(pointCount);

  const cCream = new THREE.Color(PALETTE.cream);
  const cCopper = new THREE.Color(PALETTE.copperGlow);
  const cSteel = new THREE.Color(0x94a3b5);
  const tmpColor = new THREE.Color();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < pointCount; i++) {
    const t = (i + 0.5) / pointCount;
    const y = 1 - 2 * t;
    const rUnit = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    // 3 concentric quantized radii inside the lattice volume
    const shellIdx = i % 3;
    const radius = (shellIdx === 0 ? 0.56 : shellIdx === 1 ? 0.72 : 0.88) + (rng() - 0.5) * 0.04;

    const px = Math.cos(theta) * rUnit * radius;
    const py = y * radius;
    const pz = Math.sin(theta) * rUnit * radius;

    basePointPositions[i * 3] = px;
    basePointPositions[i * 3 + 1] = py;
    basePointPositions[i * 3 + 2] = pz;

    pointPositions[i * 3] = px;
    pointPositions[i * 3 + 1] = py;
    pointPositions[i * 3 + 2] = pz;

    pointPhases[i] = rng() * Math.PI * 2;

    if (shellIdx === 0) tmpColor.copy(cCream);
    else if (shellIdx === 1) tmpColor.copy(cCopper);
    else tmpColor.copy(cSteel);

    pointColors[i * 3] = tmpColor.r;
    pointColors[i * 3 + 1] = tmpColor.g;
    pointColors[i * 3 + 2] = tmpColor.b;
  }

  const pointsGeo = new THREE.BufferGeometry();
  const pointPosAttr = new THREE.BufferAttribute(pointPositions, 3);
  pointPosAttr.setUsage(THREE.DynamicDrawUsage);
  pointsGeo.setAttribute("position", pointPosAttr);
  pointsGeo.setAttribute("color", new THREE.BufferAttribute(pointColors, 3));

  const pointsMat = new THREE.PointsMaterial({
    size: 0.056,
    map: createPointSpriteTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pointCloud = new THREE.Points(pointsGeo, pointsMat);
  pointCloudGroup.add(pointCloud);

  tagLayer(latticeGroup, "lattice");

  // =========================================================================
  // 3. THREE TILTED SPECTRAL ORBITAL RINGS (350 GHz, 500 GHz, SWIR)
  // =========================================================================
  const ringsGroup = new THREE.Group();
  assemblyGroup.add(ringsGroup);

  function createTickMarks(radius, count, tickLen, color, opacity) {
    const positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const major = i % 3 === 0 ? 1.45 : 1.0;
      const r0 = radius + 0.025;
      const r1 = r0 + tickLen * major;
      positions[i * 6] = Math.cos(a) * r0;
      positions[i * 6 + 1] = 0;
      positions[i * 6 + 2] = Math.sin(a) * r0;
      positions[i * 6 + 3] = Math.cos(a) * r1;
      positions[i * 6 + 4] = 0;
      positions[i * 6 + 5] = Math.sin(a) * r1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineSegments(geo, mat);
  }

  function createHairlineCircle(radius, segments, color, opacity) {
    const pts = [];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    return new THREE.LineLoop(geo, mat);
  }

  function createSignalNode(radius, angle, speed, nodeColor, emissiveColor) {
    const mat = new THREE.MeshStandardMaterial({
      color: nodeColor,
      emissive: emissiveColor,
      emissiveIntensity: 0.9,
      metalness: 0.45,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.038, 0), mat);
    mesh.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);

    const haloMat = new THREE.MeshBasicMaterial({
      color: emissiveColor,
      transparent: true,
      opacity: 0.45,
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.005, 8, 24), haloMat);
    halo.rotation.x = Math.PI / 2;
    mesh.add(halo);

    return { mesh, mat, radius, baseAngle: angle, speed };
  }

  const orbitingNodes = [];

  // --- Ring 1: 350 GHz ---
  const ring350Tilt = new THREE.Group();
  ring350Tilt.rotation.set(0.46, 0.18, -0.34);
  ringsGroup.add(ring350Tilt);

  const ring350Offset = new THREE.Group();
  ring350Tilt.add(ring350Offset);

  const ring350Mat = new THREE.MeshStandardMaterial({
    color: PALETTE.accentLight,
    emissive: PALETTE.accent,
    emissiveIntensity: 0.34,
    metalness: 0.8,
    roughness: 0.26,
  });
  registerHighlightMaterial("ring-350", ring350Mat, 0.34);

  const ring350Mesh = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.015, 16, 128), ring350Mat);
  ring350Mesh.rotation.x = Math.PI / 2;
  ring350Offset.add(ring350Mesh);
  ring350Offset.add(createHairlineCircle(1.255, 96, PALETTE.copperGlow, 0.34));
  ring350Offset.add(createTickMarks(1.2, 24, 0.045, PALETTE.copperGlow, 0.55));

  for (const [angle, speed] of [
    [0.4, 0.42],
    [3.55, 0.42],
  ]) {
    const n = createSignalNode(1.2, angle, speed, PALETTE.cream, PALETTE.copperGlow);
    ring350Offset.add(n.mesh);
    registerHighlightMaterial("ring-350", n.mat, 0.9);
    orbitingNodes.push(n);
  }
  tagLayer(ring350Tilt, "ring-350");

  // --- Ring 2: 500 GHz ---
  const ring500Tilt = new THREE.Group();
  ring500Tilt.rotation.set(-0.58, 0.36, 0.44);
  ringsGroup.add(ring500Tilt);

  const ring500Offset = new THREE.Group();
  ring500Tilt.add(ring500Offset);

  const ring500Mat = new THREE.MeshStandardMaterial({
    color: PALETTE.cream,
    emissive: PALETTE.copperGlow,
    emissiveIntensity: 0.28,
    metalness: 0.86,
    roughness: 0.2,
  });
  registerHighlightMaterial("ring-500", ring500Mat, 0.28);

  const ring500Outer = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.012, 14, 128), ring500Mat);
  ring500Outer.rotation.x = Math.PI / 2;
  ring500Offset.add(ring500Outer);

  const ring500Inner = new THREE.Mesh(new THREE.TorusGeometry(1.305, 0.007, 12, 128), ring500Mat);
  ring500Inner.rotation.x = Math.PI / 2;
  ring500Offset.add(ring500Inner);

  ring500Offset.add(createTickMarks(1.35, 36, 0.038, PALETTE.cream, 0.45));

  for (const [angle, speed] of [
    [1.25, -0.34],
    [4.4, -0.34],
  ]) {
    const n = createSignalNode(1.35, angle, speed, PALETTE.cream, PALETTE.copperGlow);
    ring500Offset.add(n.mesh);
    registerHighlightMaterial("ring-500", n.mat, 0.9);
    orbitingNodes.push(n);
  }
  tagLayer(ring500Tilt, "ring-500");

  // --- Ring 3: Multispectral SWIR (443–2190 nm) ---
  const ringSwirTilt = new THREE.Group();
  ringSwirTilt.rotation.set(1.08, -0.44, 0.22);
  ringsGroup.add(ringSwirTilt);

  const ringSwirOffset = new THREE.Group();
  ringSwirTilt.add(ringSwirOffset);

  const ringSwirMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b5,
    emissive: 0x3c4b5c,
    emissiveIntensity: 0.28,
    metalness: 0.78,
    roughness: 0.28,
  });
  registerHighlightMaterial("ring-swir", ringSwirMat, 0.28);

  // 4 segmented gantry arcs with copper cardinal brackets
  const arcSpan = Math.PI * 0.41;
  const arcGeo = new THREE.TorusGeometry(1.49, 0.012, 12, 40, arcSpan);
  const lugGeo = new THREE.BoxGeometry(0.042, 0.026, 0.042);
  const lugMat = new THREE.MeshStandardMaterial({
    color: PALETTE.copperGlow,
    emissive: PALETTE.accent,
    emissiveIntensity: 0.35,
    metalness: 0.8,
    roughness: 0.24,
  });
  registerHighlightMaterial("ring-swir", lugMat, 0.35);

  for (let q = 0; q < 4; q++) {
    const baseA = q * (Math.PI / 2);
    const arc = new THREE.Mesh(arcGeo, ringSwirMat);
    arc.rotation.x = Math.PI / 2;
    arc.rotation.z = baseA + 0.14;
    ringSwirOffset.add(arc);

    const lug = new THREE.Mesh(lugGeo, lugMat);
    lug.position.set(Math.cos(baseA) * 1.49, 0, Math.sin(baseA) * 1.49);
    lug.rotation.y = -baseA;
    ringSwirOffset.add(lug);
  }

  ringSwirOffset.add(createHairlineCircle(1.49, 112, 0x94a3b5, 0.3));

  for (const [angle, speed] of [
    [0.85, 0.27],
    [2.95, 0.27],
    [5.05, 0.27],
  ]) {
    const n = createSignalNode(1.49, angle, speed, 0xe4e8ee, 0x94a3b5);
    ringSwirOffset.add(n.mesh);
    registerHighlightMaterial("ring-swir", n.mat, 0.9);
    orbitingNodes.push(n);
  }
  tagLayer(ringSwirTilt, "ring-swir");

  // =========================================================================
  // 4. VOLUMETRIC SCAN GRID / REFERENCE BASE PLANE
  // =========================================================================
  const gridGroup = new THREE.Group();
  gridGroup.position.set(0, -1.38, 0);
  rootGroup.add(gridGroup);

  // Radial-faded 14x14 datum grid using RGBA vertex colors for clean alpha falloff
  const gridHalf = 1.65;
  const gridDiv = 14;
  const gridVerts = [];
  const gridCols = [];
  const lineGraphite = new THREE.Color(0x5c6674);
  const lineCopper = new THREE.Color(PALETTE.accentLight);

  function addFadedSegment(x0, z0, x1, z1, baseCol) {
    const steps = 8;
    for (let s = 0; s < steps; s++) {
      const f0 = s / steps;
      const f1 = (s + 1) / steps;
      const ax = x0 + (x1 - x0) * f0;
      const az = z0 + (z1 - z0) * f0;
      const bx = x0 + (x1 - x0) * f1;
      const bz = z0 + (z1 - z0) * f1;

      const fadeA = Math.max(0, 1 - Math.hypot(ax, az) / (gridHalf * 1.02));
      const fadeB = Math.max(0, 1 - Math.hypot(bx, bz) / (gridHalf * 1.02));
      if (fadeA <= 0.01 && fadeB <= 0.01) continue;

      const alphaA = Math.pow(fadeA, 1.35) * 0.72;
      const alphaB = Math.pow(fadeB, 1.35) * 0.72;

      gridVerts.push(ax, 0, az, bx, 0, bz);
      gridCols.push(
        baseCol.r, baseCol.g, baseCol.b, alphaA,
        baseCol.r, baseCol.g, baseCol.b, alphaB
      );
    }
  }

  for (let i = 0; i <= gridDiv; i++) {
    const coord = -gridHalf + (i / gridDiv) * (gridHalf * 2);
    const isCenter = i === gridDiv / 2;
    const col = isCenter ? lineCopper : lineGraphite;
    addFadedSegment(-gridHalf, coord, gridHalf, coord, col);
    addFadedSegment(coord, -gridHalf, coord, gridHalf, col);
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridVerts, 3));
  gridGeo.setAttribute("color", new THREE.Float32BufferAttribute(gridCols, 4));
  const gridMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  gridGroup.add(new THREE.LineSegments(gridGeo, gridMat));

  // Subtle concentric calibration circles + copper under-glow disc
  gridGroup.add(createHairlineCircle(0.88, 72, PALETTE.copperGlow, 0.26));
  gridGroup.add(createHairlineCircle(1.32, 96, 0x768292, 0.22));

  const glowDiscMat = new THREE.MeshBasicMaterial({
    map: createDatumGlowTexture(),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const glowDisc = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), glowDiscMat);
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.y = -0.004;
  gridGroup.add(glowDisc);

  // Subtle floating scan ticks right above datum surface
  const datumDotCount = 36;
  const datumDotPos = new Float32Array(datumDotCount * 3);
  for (let i = 0; i < datumDotCount; i++) {
    const a = (i / datumDotCount) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.88 : 1.32;
    datumDotPos[i * 3] = Math.cos(a) * r;
    datumDotPos[i * 3 + 1] = 0.015;
    datumDotPos[i * 3 + 2] = Math.sin(a) * r;
  }
  const datumDotGeo = new THREE.BufferGeometry();
  datumDotGeo.setAttribute("position", new THREE.BufferAttribute(datumDotPos, 3));
  const datumDotMat = new THREE.PointsMaterial({
    color: PALETTE.copperGlow,
    size: 0.032,
    map: createPointSpriteTexture(),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  gridGroup.add(new THREE.Points(datumDotGeo, datumDotMat));

  tagLayer(gridGroup, "grid");

  // =========================================================================
  // INTERACTIVITY STATE (MODES, PARALLAX, RAYCAST HOVER, CAMERA RESET)
  // =========================================================================
  let currentMode = "orbit";
  let explodeProgress = 0;
  let targetExplode = 0;
  let hoveredLayer = null;
  let resetNoticeUntil = 0;
  let elapsedTracker = 0;

  let isOrbitDragging = false;
  let isResettingCamera = false;

  const defaultCamVec = new THREE.Vector3(...DEFAULT_CAM_POS);
  const defaultTargetVec = new THREE.Vector3(...DEFAULT_TARGET);
  const defaultOffsetVec = defaultCamVec.clone().sub(defaultTargetVec);
  const defaultSpherical = new THREE.Spherical().setFromVector3(defaultOffsetVec);
  const curSpherical = new THREE.Spherical();

  const pointerNDC = new THREE.Vector2(0, 0);
  const parallaxTarget = new THREE.Vector2(0, 0);
  const parallaxCurrent = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0.05;
  raycaster.params.Points.threshold = 0.08;

  const tmpOffset = new THREE.Vector3();

  function syncModeButtons() {
    for (const btn of modeButtons) {
      const m = btn.dataset.heroMode;
      if (m === "orbit" || m === "explode") {
        btn.setAttribute("aria-selected", String(m === currentMode));
      }
    }
  }

  function refreshReadout() {
    if (hoveredLayer && LAYER_READOUT[hoveredLayer]) {
      setReadout(LAYER_READOUT[hoveredLayer]);
      return;
    }
    if (elapsedTracker < resetNoticeUntil) {
      setReadout(MODE_READOUT.reset);
      return;
    }
    setReadout(MODE_READOUT[currentMode] || MODE_READOUT.orbit);
  }

  /** Apply explode progress [0..1] cleanly to all architectural layers. */
  function applyExplodeTransforms(e) {
    // Smooth ease-in-out curve for crisp mechanical feel
    const t = e * e * (3 - 2 * e);

    // Slight scale pullback during explode so all separated shells stay inside viewport
    assemblyGroup.scale.setScalar(1 - 0.16 * t);

    // Core: nucleus stays centered while crystal shell & polar collars separate
    crystalShellGroup.position.set(-0.34 * t, 0.14 * t, 0.22 * t);
    crystalShellGroup.scale.setScalar(1 + 0.06 * t);
    topCollar.position.y = 0.44 + 0.46 * t;
    bottomCollar.position.y = -0.44 - 0.46 * t;

    // Point cloud expands outward radially & lifts slightly
    pointCloudGroup.position.set(0, 0.22 * t, -0.14 * t);
    pointCloudGroup.scale.setScalar(1 + 0.22 * t);

    // Geodesic lattices part horizontally along opposing vectors
    innerLatticeGroup.position.set(-0.88 * t, -0.12 * t, 0.2 * t);
    outerLatticeGroup.position.set(0.88 * t, 0.14 * t, -0.2 * t);

    // Spectral orbital rings translate along their own local normal (Y) axes
    ring350Offset.position.set(0, 0.56 * t, 0);
    ring500Offset.position.set(0, 0, 0);
    ringSwirOffset.position.set(0, -0.56 * t, 0);

    // Inner point light brightens slightly when core is exposed
    corePointLight.intensity = 4.2 + 2.6 * t;
  }

  function applyHighlightState(deltaSeconds) {
    const rate = deltaSeconds > 0 ? 1 - Math.exp(-10 * deltaSeconds) : 1;
    for (const [key, entries] of Object.entries(layerEmissives)) {
      const boost = hoveredLayer === key ? 0.55 : 0;
      for (const item of entries) {
        const target = item.base + boost;
        item.material.emissiveIntensity += (target - item.material.emissiveIntensity) * rate;
      }
    }
    const datumTarget = hoveredLayer === "grid" ? 0.95 : 0.55;
    datumDotMat.opacity += (datumTarget - datumDotMat.opacity) * rate;
  }

  function setMode(mode) {
    if (mode === "reset") {
      currentMode = "orbit";
      targetExplode = 0;
      hoveredLayer = null;
      parallaxTarget.set(0, 0);
      resetNoticeUntil = elapsedTracker + 1.35;
      syncModeButtons();

      if (prefersReducedMotion()) {
        isResettingCamera = false;
        explodeProgress = 0;
        applyExplodeTransforms(0);
        applyHighlightState(0);
        stage.resetCamera();
        stage.render();
      } else {
        if (controls) {
          const prevDamping = controls.enableDamping;
          controls.enableDamping = false;
          controls.update();
          controls.enableDamping = prevDamping;
        }
        isResettingCamera = true;
      }
      refreshReadout();
      return;
    }

    if (mode !== "orbit" && mode !== "explode") return;
    currentMode = mode;
    targetExplode = mode === "explode" ? 1 : 0;
    resetNoticeUntil = 0;
    syncModeButtons();

    if (prefersReducedMotion()) {
      explodeProgress = targetExplode;
      applyExplodeTransforms(explodeProgress);
      stage.render();
    }
    refreshReadout();
  }

  for (const btn of modeButtons) {
    btn.addEventListener("click", () => {
      setMode(btn.dataset.heroMode);
    });
  }

  // Controls events
  const onControlsStart = () => {
    isOrbitDragging = true;
    isResettingCamera = false;
  };
  const onControlsEnd = () => {
    isOrbitDragging = false;
  };
  if (controls) {
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);
  }

  // Pointer parallax + raycast hover
  function updateHoverFromPointer(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(rootGroup.children, true);

    let nextLayer = null;
    for (const hit of hits) {
      if (hit.object && hit.object.userData && hit.object.userData.layerKey) {
        nextLayer = hit.object.userData.layerKey;
        break;
      }
    }

    if (nextLayer !== hoveredLayer) {
      hoveredLayer = nextLayer;
      refreshReadout();
      if (prefersReducedMotion()) {
        applyHighlightState(0);
        stage.render();
      }
    }
  }

  const onCanvasPointerMove = (event) => {
    if (isOrbitDragging) return;
    if (event.pointerType === "mouse") {
      updateHoverFromPointer(event.clientX, event.clientY);
    }
  };

  const onCanvasPointerLeave = () => {
    if (hoveredLayer !== null) {
      hoveredLayer = null;
      refreshReadout();
      if (prefersReducedMotion()) {
        applyHighlightState(0);
        stage.render();
      }
    }
  };

  const onWrapPointerMove = (event) => {
    if (prefersReducedMotion() || isOrbitDragging || event.pointerType !== "mouse" || !wrap) {
      return;
    }
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    parallaxTarget.set(
      THREE.MathUtils.clamp(nx, -1, 1),
      THREE.MathUtils.clamp(ny, -1, 1)
    );
  };

  const onWrapPointerLeave = () => {
    parallaxTarget.set(0, 0);
  };

  renderer.domElement.addEventListener("pointermove", onCanvasPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerleave", onCanvasPointerLeave, { passive: true });
  if (wrap) {
    wrap.addEventListener("pointermove", onWrapPointerMove, { passive: true });
    wrap.addEventListener("pointerleave", onWrapPointerLeave, { passive: true });
  }

  // =========================================================================
  // SCROLL-COUPLED SETTLE & ENTRANCE
  // =========================================================================
  const ENTRANCE_DURATION = 0.5;
  const SCROLL_Y_SHIFT = -0.15;
  const SCROLL_ROT_SWEEP = 0.35;
  const heroSection = container.closest(".hero") || wrap || container;
  let scrollTarget = 0;
  let scrollCurrent = 0;

  function readHeroScrollProgress() {
    if (prefersReducedMotion()) {
      scrollTarget = 0;
      return;
    }
    const scrollY = window.scrollY || window.pageYOffset || 0;
    if (scrollY <= 0) {
      scrollTarget = 0;
      return;
    }
    const rect = heroSection.getBoundingClientRect();
    const docBottom = Math.max(scrollY + rect.bottom, 1);
    scrollTarget = THREE.MathUtils.clamp(scrollY / docBottom, 0, 1);
  }

  function resetScrollAndEntrance() {
    scrollTarget = 0;
    scrollCurrent = 0;
    rootGroup.position.y = 0;
    rootGroup.rotation.y = 0;
    rootGroup.scale.setScalar(1);
  }

  readHeroScrollProgress();
  scrollCurrent = scrollTarget;

  if (prefersReducedMotion()) {
    resetScrollAndEntrance();
  } else {
    rootGroup.position.y = SCROLL_Y_SHIFT * scrollCurrent;
    rootGroup.rotation.y = SCROLL_ROT_SWEEP * scrollCurrent;
    rootGroup.scale.setScalar(0.94);
  }

  window.addEventListener("scroll", readHeroScrollProgress, { passive: true });
  window.addEventListener("resize", readHeroScrollProgress, { passive: true });

  const motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  const onMotionChange = () => {
    if (prefersReducedMotion()) {
      resetScrollAndEntrance();
      stage.render();
    } else {
      readHeroScrollProgress();
    }
  };
  if (motionQuery && typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  }

  // =========================================================================
  // ANIMATION LOOP
  // =========================================================================
  applyExplodeTransforms(0);
  syncModeButtons();

  stage.setAnimationLoop((elapsed, delta) => {
    elapsedTracker = elapsed;

    if (prefersReducedMotion()) {
      resetScrollAndEntrance();
    }

    // 1. Smooth explode / collapse interpolation
    if (Math.abs(explodeProgress - targetExplode) > 0.0005) {
      const k = delta > 0 ? 1 - Math.exp(-6.5 * delta) : 1;
      explodeProgress += (targetExplode - explodeProgress) * k;
      if (Math.abs(explodeProgress - targetExplode) <= 0.0005) {
        explodeProgress = targetExplode;
      }
      applyExplodeTransforms(explodeProgress);
    }

    // 2. Smooth reset camera interpolation along orbital spherical arc
    if (isResettingCamera && controls) {
      const k = delta > 0 ? 1 - Math.exp(-7.2 * delta) : 1;
      controls.target.lerp(defaultTargetVec, k);

      tmpOffset.copy(camera.position).sub(controls.target);
      curSpherical.setFromVector3(tmpOffset);

      let dTheta = defaultSpherical.theta - curSpherical.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;

      curSpherical.theta += dTheta * k;
      curSpherical.phi += (defaultSpherical.phi - curSpherical.phi) * k;
      curSpherical.radius += (defaultSpherical.radius - curSpherical.radius) * k;

      tmpOffset.setFromSpherical(curSpherical);
      camera.position.copy(controls.target).add(tmpOffset);
      camera.lookAt(controls.target);

      if (
        camera.position.distanceTo(defaultCamVec) < 0.015 &&
        controls.target.distanceTo(defaultTargetVec) < 0.01
      ) {
        isResettingCamera = false;
        stage.resetCamera();
      }
    }

    // Expire transient reset notice cleanly
    if (resetNoticeUntil > 0 && elapsed >= resetNoticeUntil && !hoveredLayer) {
      resetNoticeUntil = 0;
      refreshReadout();
    }

    // 3. Harmonic & scroll-coupled motion (skipped on static delta===0 initial frame)
    if (delta > 0) {
      if (!prefersReducedMotion()) {
        // Initial entrance settle (0.94 -> 1.0 scale over ~500ms)
        const entranceT = Math.min(1, Math.max(0, elapsed / ENTRANCE_DURATION));
        const entranceEase = 1 - Math.pow(1 - entranceT, 3);
        rootGroup.scale.setScalar(0.94 + 0.06 * entranceEase);

        // Purposeful scroll-coupled vertical settle & rotational sweep
        const sk = 1 - Math.exp(-8.0 * delta);
        scrollCurrent += (scrollTarget - scrollCurrent) * sk;
        if (Math.abs(scrollTarget - scrollCurrent) < 0.0005) {
          scrollCurrent = scrollTarget;
        }
        rootGroup.position.y = SCROLL_Y_SHIFT * scrollCurrent;
        rootGroup.rotation.y = SCROLL_ROT_SWEEP * scrollCurrent;
      }

      // Gentle hover parallax on outer assembly
      const pk = 1 - Math.exp(-5.0 * delta);
      parallaxCurrent.lerp(parallaxTarget, pk);
      parallaxGroup.rotation.y = parallaxCurrent.x * 0.085;
      parallaxGroup.rotation.x = parallaxCurrent.y * 0.06;

      // Subtle continuous instrument motion
      nucleusMesh.rotation.y = elapsed * 0.42;
      nucleusMesh.rotation.x = Math.sin(elapsed * 0.5) * 0.25;

      crystalShellGroup.rotation.y = -elapsed * 0.16;
      crystalShellGroup.rotation.z = Math.sin(elapsed * 0.35) * 0.08;

      innerLatticeGroup.rotation.y = elapsed * 0.09;
      outerLatticeGroup.rotation.y = -elapsed * 0.07;
      outerLatticeGroup.rotation.x = Math.sin(elapsed * 0.22) * 0.05;

      // Gentle levitation harmonic
      assemblyGroup.position.y = 0.24 + Math.sin(elapsed * 1.15) * 0.032;

      // Volumetric point-cloud gentle radial breathing
      const posArr = pointPosAttr.array;
      for (let i = 0; i < pointCount; i++) {
        const pulse = 1 + 0.045 * Math.sin(elapsed * 1.6 + pointPhases[i]);
        const i3 = i * 3;
        posArr[i3] = basePointPositions[i3] * pulse;
        posArr[i3 + 1] = basePointPositions[i3 + 1] * pulse;
        posArr[i3 + 2] = basePointPositions[i3 + 2] * pulse;
      }
      pointPosAttr.needsUpdate = true;

      // Ring precession & orbiting signal nodes
      ring350Tilt.rotation.y = 0.18 + elapsed * 0.075;
      ring500Tilt.rotation.y = 0.36 - elapsed * 0.06;
      ringSwirTilt.rotation.y = -0.44 + elapsed * 0.045;

      for (const node of orbitingNodes) {
        const a = node.baseAngle + elapsed * node.speed;
        node.mesh.position.set(Math.cos(a) * node.radius, 0, Math.sin(a) * node.radius);
        node.mesh.rotation.y = -a;
      }
    }

    // 4. Smooth hover emissive boost
    applyHighlightState(delta);
  });

  // =========================================================================
  // CLEANUP ON UNLOAD
  // =========================================================================
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;

    window.removeEventListener("scroll", readHeroScrollProgress);
    window.removeEventListener("resize", readHeroScrollProgress);
    if (motionQuery && typeof motionQuery.removeEventListener === "function") {
      motionQuery.removeEventListener("change", onMotionChange);
    }

    if (controls) {
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
    }
    renderer.domElement.removeEventListener("pointermove", onCanvasPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onCanvasPointerLeave);
    if (wrap) {
      wrap.removeEventListener("pointermove", onWrapPointerMove);
      wrap.removeEventListener("pointerleave", onWrapPointerLeave);
    }

    const geometries = new Set();
    const materials = new Set();
    scene.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry);
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) materials.add(m);
        } else {
          materials.add(obj.material);
        }
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of disposables.textures) t.dispose();
    if (disposables.envRT) {
      disposables.envRT.dispose();
      scene.environment = null;
    }

    stage.dispose();
  }

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) cleanup();
  });
})();
