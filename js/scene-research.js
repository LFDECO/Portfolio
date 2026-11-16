import { THREE, PALETTE, prefersReducedMotion, createStage } from "./three-core.js";

const N = 46;
const SLAB_SIZE = 3.1;
const SLAB_THICKNESS = SLAB_SIZE * (6 / N); // Exact 46 × 46 × 6 mm proportions
const RELIEF_MAX_HEIGHT = 0.72;

const VOIDS = [
  { name: "Void A", x: 29.5, y: 16.5, rx: 4.2, ry: 3.0, a: 0.22 },
  { name: "Void B", x: 14.5, y: 30.5, rx: 2.4, ry: 2.0, a: 0.15 },
];

const THERMAL_STOPS = [
  [0.0, [9, 11, 13]],
  [0.22, [52, 36, 30]],
  [0.45, [128, 54, 24]],
  [0.65, [196, 98, 42]],
  [0.84, [232, 166, 94]],
  [1.0, [247, 233, 200]],
];

const THZ_IDLE_READOUT = {
  "3d-specimen": "46 × 46 × 6 mm · 2 voids",
  "3d-relief": "46 × 46 mm · fused thermal relief",
};

const SENTINEL_BANDS = [
  { index: 0, code: "B1", nm: 443, region: "Coastal aerosol", group: "coastal" },
  { index: 1, code: "B2", nm: 490, region: "Blue · RGB prior", group: "rgb" },
  { index: 2, code: "B3", nm: 560, region: "Green · RGB prior", group: "rgb" },
  { index: 3, code: "B4", nm: 665, region: "Red · RGB prior", group: "rgb" },
  { index: 4, code: "B5", nm: 705, region: "Red Edge 1", group: "red-edge" },
  { index: 5, code: "B6", nm: 740, region: "Red Edge 2", group: "red-edge" },
  { index: 6, code: "B7", nm: 783, region: "Red Edge 3", group: "red-edge" },
  { index: 7, code: "B8", nm: 842, region: "NIR", group: "nir" },
  { index: 8, code: "B8A", nm: 865, region: "Narrow NIR", group: "nir" },
  { index: 9, code: "B9", nm: 945, region: "Water vapour", group: "nir" },
  { index: 10, code: "B10", nm: 1375, region: "SWIR · Cirrus", group: "swir" },
  { index: 11, code: "B11", nm: 1610, region: "SWIR 1", group: "swir" },
  { index: 12, code: "B12", nm: 2190, region: "SWIR 2", group: "swir" },
];

const SPECTRAL_IDLE_READOUT = "13 bands (443–2190 nm) → 1×1 conv (45 params) → 3 ch";

function mmToWorld(mm) {
  return ((mm - 22.5) / (N - 1)) * SLAB_SIZE;
}

function mmRadiusToWorld(rMm) {
  return (rMm / (N - 1)) * SLAB_SIZE;
}

function worldToMm(wx, wz) {
  const x = Math.round((wx / SLAB_SIZE) * (N - 1) + 22.5);
  const y = Math.round((wz / SLAB_SIZE) * (N - 1) + 22.5);
  return {
    x: Math.min(N - 1, Math.max(0, x)),
    y: Math.min(N - 1, Math.max(0, y)),
  };
}

function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

/**
 * Evaluate the copper thermal colormap matching script.js.
 * @param {number} t - Normalized intensity in [0, 1].
 * @returns {[number, number, number]} sRGB triplet in [0, 255].
 */
function sampleThermalStop(t) {
  const u = clamp01(t);
  for (let i = 1; i < THERMAL_STOPS.length; i++) {
    if (u <= THERMAL_STOPS[i][0]) {
      const [t0, c0] = THERMAL_STOPS[i - 1];
      const [t1, c1] = THERMAL_STOPS[i];
      const f = (u - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return THERMAL_STOPS[THERMAL_STOPS.length - 1][1];
}

/**
 * Compute deterministic 46x46 synthetic THz reflection maps matching script.js.
 */
function computeThzSimulation() {
  const rng = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (r) => {
    const u = Math.max(r(), 1e-9);
    const v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const inside = (x, y) => x >= 5 && x <= 40 && y >= 5 && y <= 40;

  const truth = (x, y, freq) => {
    if (!inside(x, y)) return 0.08;
    let v = 0.5;
    const infill = Math.cos((2 * Math.PI * (x + y)) / 5.5);
    v += (freq === 500 ? 0.05 : 0.025) * infill;
    for (const d of VOIDS) {
      const q = ((x - d.x) / d.rx) ** 2 + ((y - d.y) / d.ry) ** 2;
      if (q < 1) v += d.a * (freq === 500 ? 1 : 0.8);
    }
    const edge = Math.min(x - 5, 40 - x, y - 5, 40 - y);
    if (edge < 1.5) v += 0.22 * (1 - edge / 1.5);
    return v;
  };

  const blur = (src, sigma) => {
    const k = [];
    const R = Math.ceil(sigma * 3);
    let s = 0;
    for (let i = -R; i <= R; i++) {
      const w = Math.exp(-(i * i) / (2 * sigma * sigma));
      k.push(w);
      s += w;
    }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const tmp = new Float32Array(N * N);
    const out = new Float32Array(N * N);
    const at = (a, x, y) => a[Math.min(N - 1, Math.max(0, y)) * N + Math.min(N - 1, Math.max(0, x))];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (let i = -R; i <= R; i++) v += k[i + R] * at(src, x + i, y);
        tmp[y * N + x] = v;
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0;
        for (let i = -R; i <= R; i++) v += k[i + R] * at(tmp, x, y + i);
        out[y * N + x] = v;
      }
    }
    return out;
  };

  const band = (freq, sigma, noise, seed) => {
    const r = rng(seed);
    const t = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) t[y * N + x] = truth(x, y, freq);
    }
    const b = blur(t, sigma);
    for (let i = 0; i < b.length; i++) b[i] += noise * gauss(r);
    return b;
  };

  const interiorMedian = (a) => {
    const vals = [];
    for (let y = 8; y <= 37; y++) {
      for (let x = 8; x <= 37; x++) vals.push(a[y * N + x]);
    }
    vals.sort((p, q) => p - q);
    return vals[vals.length >> 1];
  };

  const b350 = band(350, 1.7, 0.03, 7);
  const b500 = band(500, 1.15, 0.05, 11);
  const m350 = interiorMedian(b350);
  const m500 = interiorMedian(b500);

  const fused = new Float32Array(N * N);
  for (let i = 0; i < fused.length; i++) {
    const x = i % N;
    const y = (i / N) | 0;
    const masked = !inside(x, y) ? 0.16 : Math.min(x - 5, 40 - x, y - 5, 40 - y) < 2 ? 1 : null;
    fused[i] = masked ?? 0.5 * (b350[i] / m350 + b500[i] / m500);
  }

  const fVals = [];
  for (let y = 8; y <= 37; y++) {
    for (let x = 8; x <= 37; x++) fVals.push(fused[y * N + x]);
  }
  fVals.sort((p, q) => p - q);
  const med = fVals[fVals.length >> 1];
  const mad = fVals.map((v) => Math.abs(v - med)).sort((p, q) => p - q)[fVals.length >> 1];
  const thresh = med + 6 * mad;

  const mask = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) mask[i] = fused[i] > thresh ? 1 : 0;

  return { b350, b500, fused, mask, lo: 0.55, hi: 1.45 };
}

function disposeSceneResources(scene) {
  const geometries = new Set();
  const materials = new Set();
  scene.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => materials.add(m));
      } else {
        materials.add(obj.material);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

function createEdgesLine(geometry, color, opacity = 0.9) {
  const edges = new THREE.EdgesGeometry(geometry);
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
  });
  return new THREE.LineSegments(edges, mat);
}

/**
 * Build a millimeter reference stage reticle beneath the 46x46 mm specimen/relief.
 */
function buildThzReferenceStage(baseY) {
  const group = new THREE.Group();
  const half = SLAB_SIZE * 0.5;
  const pad = 0.24;
  const outer = half + pad;

  const points = [];
  const pushSeg = (x0, y0, z0, x1, y1, z1) => {
    points.push(x0, y0, z0, x1, y1, z1);
  };

  // Subtle 46x46 mm boundary and 10 mm tick marks along edges
  pushSeg(-half, baseY, -half, half, baseY, -half);
  pushSeg(half, baseY, -half, half, baseY, half);
  pushSeg(half, baseY, half, -half, baseY, half);
  pushSeg(-half, baseY, half, -half, baseY, -half);

  for (let mm = 0; mm <= 45; mm += 5) {
    const p = mmToWorld(mm);
    const tick = mm % 10 === 0 ? 0.11 : 0.055;
    pushSeg(p, baseY, half, p, baseY, half + tick);
    pushSeg(p, baseY, -half, p, baseY, -half - tick);
    pushSeg(-half, baseY, p, -half - tick, baseY, p);
    pushSeg(half, baseY, p, half + tick, baseY, p);
  }

  // Corner L-brackets on outer frame
  const bLen = 0.24;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * outer;
      const cz = sz * outer;
      pushSeg(cx, baseY, cz, cx - sx * bLen, baseY, cz);
      pushSeg(cx, baseY, cz, cx, baseY, cz - sz * bLen);
    }
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const gridLines = new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({ color: 0x8a909a, transparent: true, opacity: 0.58 })
  );
  group.add(gridLines);

  return group;
}

/**
 * Build 45-degree alternating rectilinear FDM infill struts clipped inside the slab.
 */
function buildRectilinearInfill() {
  const halfInner = SLAB_SIZE * 0.5 - 0.09;
  const pitchWorld = mmRadiusToWorld(4.6);
  const layerHeights = [
    { y: -SLAB_THICKNESS * 0.24, dir: 1 },
    { y: -SLAB_THICKNESS * 0.08, dir: -1 },
    { y: SLAB_THICKNESS * 0.08, dir: 1 },
    { y: SLAB_THICKNESS * 0.24, dir: -1 },
  ];

  const posPlus = [];
  const posMinus = [];

  for (const { y, dir } of layerHeights) {
    const target = dir === 1 ? posPlus : posMinus;
    const maxC = halfInner * 2;
    for (let c = -maxC + pitchWorld * 0.5; c <= maxC - pitchWorld * 0.5; c += pitchWorld) {
      const xMin = Math.max(-halfInner, c - halfInner);
      const xMax = Math.min(halfInner, c + halfInner);
      if (xMax - xMin < 0.02) continue;
      const z0 = dir === 1 ? c - xMin : xMin - c;
      const z1 = dir === 1 ? c - xMax : xMax - c;
      target.push(xMin, y, z0, xMax, y, z1);
    }
  }

  const group = new THREE.Group();

  const makeLayer = (positions, color, opacity) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity })
    );
  };

  group.add(makeLayer(posPlus, 0x9aa3b0, 0.48));
  group.add(makeLayer(posMinus, 0xd49a6e, 0.38));

  // Inner FDM sample perimeter boundary [5..40 mm] matching the 2D scan coupon rim
  const minW = mmToWorld(5);
  const maxW = mmToWorld(40);
  const rimY = SLAB_THICKNESS * 0.5 + 0.002;
  const rimGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(minW, rimY, minW),
    new THREE.Vector3(maxW, rimY, minW),
    new THREE.Vector3(maxW, rimY, maxW),
    new THREE.Vector3(minW, rimY, maxW),
  ]);
  const rimLoop = new THREE.LineLoop(
    rimGeo,
    new THREE.LineBasicMaterial({ color: PALETTE.accentLight, transparent: true, opacity: 0.68 })
  );
  group.add(rimLoop);

  return group;
}

/**
 * Build the 3D FDM polymer specimen assembly with internal infill, subsurface voids, and THz beam.
 */
function buildSpecimenGroup() {
  const group = new THREE.Group();

  // Translucent dark-graphite polymer slab (46 x 46 x 6 mm)
  const slabGeo = new THREE.BoxGeometry(SLAB_SIZE, SLAB_THICKNESS, SLAB_SIZE);
  const slabMat = new THREE.MeshPhysicalMaterial({
    color: 0x282d37,
    emissive: 0x0d1015,
    emissiveIntensity: 0.18,
    roughness: 0.3,
    metalness: 0.08,
    transparent: true,
    opacity: 0.38,
    clearcoat: 0.45,
    clearcoatRoughness: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const slabMesh = new THREE.Mesh(slabGeo, slabMat);
  slabMesh.renderOrder = 2;
  group.add(slabMesh);

  // Invisible solid pick plane on top face for smooth mm-coordinate raycasting
  const pickPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(SLAB_SIZE, SLAB_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  pickPlane.position.y = SLAB_THICKNESS * 0.5 + 0.004;
  group.add(pickPlane);

  // Crisp copper + cream wireframe bounds (slightly offset to eliminate edge coplanarity)
  const slabEdgeGeo = new THREE.BoxGeometry(SLAB_SIZE + 0.002, SLAB_THICKNESS + 0.002, SLAB_SIZE + 0.002);
  group.add(createEdgesLine(slabEdgeGeo, PALETTE.copperGlow, 0.88));
  const cornerGeo = new THREE.BoxGeometry(SLAB_SIZE + 0.014, SLAB_THICKNESS + 0.014, SLAB_SIZE + 0.014);
  group.add(createEdgesLine(cornerGeo, PALETTE.cream, 0.32));

  // Subtle FDM print-layer striations along the 6 mm perimeter walls
  const layerPts = [];
  const halfS = SLAB_SIZE * 0.5 + 0.001;
  for (let l = 1; l <= 4; l++) {
    const ly = -SLAB_THICKNESS * 0.5 + (SLAB_THICKNESS * l) / 5;
    layerPts.push(
      -halfS, ly, -halfS, halfS, ly, -halfS,
      halfS, ly, -halfS, halfS, ly, halfS,
      halfS, ly, halfS, -halfS, ly, halfS,
      -halfS, ly, halfS, -halfS, ly, -halfS
    );
  }
  const layerGeo = new THREE.BufferGeometry();
  layerGeo.setAttribute("position", new THREE.Float32BufferAttribute(layerPts, 3));
  group.add(
    new THREE.LineSegments(
      layerGeo,
      new THREE.LineBasicMaterial({ color: 0x8a909a, transparent: true, opacity: 0.34 })
    )
  );

  // 45° rectilinear internal infill
  group.add(buildRectilinearInfill());

  // Subsurface void defects matching (29.5, 16.5) and (14.5, 30.5)
  const voidAssemblies = [];
  const coreGeo = new THREE.SphereGeometry(1, 28, 20);
  const shellGeo = new THREE.IcosahedronGeometry(1, 2);

  VOIDS.forEach((v, idx) => {
    const voidGroup = new THREE.Group();
    const wx = mmToWorld(v.x);
    const wz = mmToWorld(v.y);
    const wy = idx === 0 ? 0.016 : -0.014;
    const rxW = mmRadiusToWorld(v.rx);
    const rzW = mmRadiusToWorld(v.ry);
    const ryW = SLAB_THICKNESS * (idx === 0 ? 0.28 : 0.22);

    voidGroup.position.set(wx, wy, wz);

    // Warm copper inner void core
    const outerCoreMat = new THREE.MeshStandardMaterial({
      color: PALETTE.copperGlow,
      emissive: PALETTE.accentLight,
      emissiveIntensity: idx === 0 ? 0.95 : 0.78,
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    const outerCore = new THREE.Mesh(coreGeo, outerCoreMat);
    outerCore.scale.set(rxW, ryW, rzW);
    voidGroup.add(outerCore);

    // Hot cream inner nucleus
    const innerCoreMat = new THREE.MeshStandardMaterial({
      color: PALETTE.cream,
      emissive: PALETTE.cream,
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });
    const innerCore = new THREE.Mesh(coreGeo, innerCoreMat);
    innerCore.scale.set(rxW * 0.54, ryW * 0.56, rzW * 0.54);
    voidGroup.add(innerCore);

    // Wireframe segmentation shell around void
    const shell = new THREE.LineSegments(
      new THREE.WireframeGeometry(shellGeo),
      new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.72 })
    );
    shell.scale.set(rxW * 1.14, ryW * 1.18, rzW * 1.14);
    voidGroup.add(shell);

    // Surface projection ring directly above defect on top face
    const ringPts = [];
    const segs = 40;
    for (let s = 0; s < segs; s++) {
      const theta = (s / segs) * Math.PI * 2;
      ringPts.push(
        new THREE.Vector3(
          Math.cos(theta) * rxW * 1.05,
          SLAB_THICKNESS * 0.5 - wy + 0.005,
          Math.sin(theta) * rzW * 1.05
        )
      );
    }
    const ringMat = new THREE.LineBasicMaterial({
      color: PALETTE.cream,
      transparent: true,
      opacity: 0.75,
    });
    voidGroup.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));

    group.add(voidGroup);
    voidAssemblies.push({
      def: v,
      wx,
      wz,
      outerCoreMat,
      shell,
      baseEmissive: idx === 0 ? 0.95 : 0.78,
    });
  });

  // Animated THz raster laser / beam crosshair & focal cone
  const { beamGroup, coneMat } = buildThzBeamAssembly();
  beamGroup.position.set(mmToWorld(VOIDS[0].x), 0, mmToWorld(VOIDS[0].y));
  group.add(beamGroup);

  return { group, pickPlane, beamGroup, coneMat, voidAssemblies };
}

/**
 * Build the animated THz raster beam focal cone, emitter ring, and top-face crosshair.
 */
function buildThzBeamAssembly() {
  const beamGroup = new THREE.Group();
  const topY = SLAB_THICKNESS * 0.5 + 0.008;
  const emitterY = topY + 0.92;

  const emitterRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.015, 10, 28).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: PALETTE.copperGlow,
      emissive: PALETTE.accent,
      emissiveIntensity: 0.55,
      metalness: 0.65,
      roughness: 0.25,
    })
  );
  emitterRing.position.y = emitterY;
  beamGroup.add(emitterRing);

  const coneHeight = emitterY - topY;
  const beamRadiusMm = mmRadiusToWorld(1.8); // ~3.6 mm diffraction-limited THz waist
  const coneGeo = new THREE.ConeGeometry(0.105, coneHeight, 24, 1, true);
  coneGeo.rotateX(Math.PI);
  const coneMat = new THREE.MeshBasicMaterial({
    color: PALETTE.copperGlow,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const focalCone = new THREE.Mesh(coneGeo, coneMat);
  focalCone.position.y = topY + coneHeight * 0.5;
  beamGroup.add(focalCone);

  const beamAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, emitterY, 0),
    new THREE.Vector3(0, topY, 0),
  ]);
  beamGroup.add(
    new THREE.Line(
      beamAxisGeo,
      new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.72 })
    )
  );

  const spotDisc = new THREE.Mesh(
    new THREE.CircleGeometry(beamRadiusMm * 0.36, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: PALETTE.cream,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    })
  );
  spotDisc.position.y = topY;
  beamGroup.add(spotDisc);

  const ringPoints = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ringPoints.push(new THREE.Vector3(Math.cos(a) * beamRadiusMm, topY + 0.002, Math.sin(a) * beamRadiusMm));
  }
  beamGroup.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({ color: PALETTE.copperGlow, transparent: true, opacity: 0.88 })
    )
  );

  const crossLen = 0.24;
  const crossPts = [
    -crossLen, topY + 0.002, 0, -beamRadiusMm * 1.25, topY + 0.002, 0,
    beamRadiusMm * 1.25, topY + 0.002, 0, crossLen, topY + 0.002, 0,
    0, topY + 0.002, -crossLen, 0, topY + 0.002, -beamRadiusMm * 1.25,
    0, topY + 0.002, beamRadiusMm * 1.25, 0, topY + 0.002, crossLen,
  ];
  const crossGeo = new THREE.BufferGeometry();
  crossGeo.setAttribute("position", new THREE.Float32BufferAttribute(crossPts, 3));
  beamGroup.add(
    new THREE.LineSegments(
      crossGeo,
      new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.82 })
    )
  );

  return { beamGroup, coneMat };
}

/**
 * Build the 3D 46x46 displaced thermal reflection relief mesh from fused simulation data.
 */
function buildReliefGroup(sim) {
  const group = new THREE.Group();
  const baseY = -SLAB_THICKNESS * 0.5;

  // Heightmap plane (46 x 46 vertices matching exact simulation coordinates)
  const geo = new THREE.PlaneGeometry(SLAB_SIZE, SLAB_SIZE, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const heights = new Float32Array(N * N);

  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const idx = iy * N + ix;
      const t = clamp01((sim.fused[idx] - sim.lo) / (sim.hi - sim.lo));
      const h = baseY + 0.04 + t * RELIEF_MAX_HEIGHT;
      heights[idx] = h;
      pos.setY(idx, h);

      const [r, g, b] = sampleThermalStop(t);
      color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      colors[idx * 3] = color.r;
      colors[idx * 3 + 1] = color.g;
      colors[idx * 3 + 2] = color.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const surfaceMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.14,
    side: THREE.DoubleSide,
  });
  const surfaceMesh = new THREE.Mesh(geo, surfaceMat);
  group.add(surfaceMesh);

  // Subtle topographic grid lines every 3 px across the surface
  const gridPts = [];
  for (let iy = 0; iy < N; iy += 3) {
    for (let ix = 0; ix < N - 1; ix++) {
      const i0 = iy * N + ix;
      const i1 = iy * N + ix + 1;
      gridPts.push(
        pos.getX(i0), heights[i0] + 0.004, pos.getZ(i0),
        pos.getX(i1), heights[i1] + 0.004, pos.getZ(i1)
      );
    }
  }
  for (let ix = 0; ix < N; ix += 3) {
    for (let iy = 0; iy < N - 1; iy++) {
      const i0 = iy * N + ix;
      const i1 = (iy + 1) * N + ix;
      gridPts.push(
        pos.getX(i0), heights[i0] + 0.004, pos.getZ(i0),
        pos.getX(i1), heights[i1] + 0.004, pos.getZ(i1)
      );
    }
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  group.add(
    new THREE.LineSegments(
      gridGeo,
      new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.2 })
    )
  );

  // Segmentation mask contour lifted onto the 3D relief peaks
  const contourPts = [];
  const maskAt = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? sim.mask[y * N + x] : 0);
  const hAt = (x, y) => {
    const cx = Math.min(N - 1, Math.max(0, x));
    const cy = Math.min(N - 1, Math.max(0, y));
    return heights[cy * N + cx] + 0.012;
  };
  const step = SLAB_SIZE / (N - 1);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!maskAt(x, y)) continue;
      const wx = mmToWorld(x);
      const wz = mmToWorld(y);
      const h = hAt(x, y);
      if (!maskAt(x, y - 1)) {
        contourPts.push(wx - step * 0.5, h, wz - step * 0.5, wx + step * 0.5, h, wz - step * 0.5);
      }
      if (!maskAt(x, y + 1)) {
        contourPts.push(wx - step * 0.5, h, wz + step * 0.5, wx + step * 0.5, h, wz + step * 0.5);
      }
      if (!maskAt(x - 1, y)) {
        contourPts.push(wx - step * 0.5, h, wz - step * 0.5, wx - step * 0.5, h, wz + step * 0.5);
      }
      if (!maskAt(x + 1, y)) {
        contourPts.push(wx + step * 0.5, h, wz - step * 0.5, wx + step * 0.5, h, wz + step * 0.5);
      }
    }
  }
  const contourGeo = new THREE.BufferGeometry();
  contourGeo.setAttribute("position", new THREE.Float32BufferAttribute(contourPts, 3));
  group.add(
    new THREE.LineSegments(
      contourGeo,
      new THREE.LineBasicMaterial({ color: PALETTE.cream, transparent: true, opacity: 0.92 })
    )
  );

  // Dark plinth base positioned just beneath the heightmap floor (avoids coplanar z-fighting)
  const plinthGeo = new THREE.BoxGeometry(SLAB_SIZE, 0.08, SLAB_SIZE);
  const plinth = new THREE.Mesh(
    plinthGeo,
    new THREE.MeshStandardMaterial({
      color: 0x1b1f26,
      roughness: 0.58,
      metalness: 0.18,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  );
  plinth.position.y = baseY - 0.006;
  group.add(plinth);
  const plinthEdgeGeo = new THREE.BoxGeometry(SLAB_SIZE + 0.003, 0.08 + 0.003, SLAB_SIZE + 0.003);
  const plinthEdges = createEdgesLine(plinthEdgeGeo, 0xa2a9b4, 0.72);
  plinthEdges.position.y = baseY - 0.006;
  group.add(plinthEdges);

  return { group, surfaceMesh };
}

/**
 * Initialize Stage 1: 3D Terahertz FDM Polymer Specimen & Reflection Relief (#thz-3d).
 */
function initThzStage() {
  const container = document.getElementById("thz-3d");
  if (!container) return null;

  const figure = document.getElementById("thz-figure");
  const readout = document.getElementById("readout");
  const selectedTab = figure?.querySelector("[data-band][aria-selected='true']");
  let currentMode = selectedTab?.dataset.band || "3d-specimen";

  const stage = createStage(container, {
    orbit: true,
    fov: 38,
    cameraPos: [3.55, 3.35, 4.75],
    target: [0, 0.08, 0],
    minPolarAngle: 0.18,
    maxPolarAngle: Math.PI * 0.62,
  });
  if (!stage.isSupported) return null;

  const { scene, camera, renderer, controls } = stage;

  // Lighting
  scene.add(new THREE.AmbientLight(0xd9dde6, 0.68));
  scene.add(new THREE.HemisphereLight(PALETTE.cream, 0x0d0f13, 0.54));
  const keyLight = new THREE.DirectionalLight(PALETTE.cream, 1.95);
  keyLight.position.set(4.2, 6.8, 4.8);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(PALETTE.copperGlow, 1.25);
  rimLight.position.set(-4.5, 3.2, -4.2);
  scene.add(rimLight);

  const sim = computeThzSimulation();
  const rootGroup = new THREE.Group();
  rootGroup.add(buildThzReferenceStage(-SLAB_THICKNESS * 0.5 - 0.058));

  const specimen = buildSpecimenGroup();
  const relief = buildReliefGroup(sim);
  rootGroup.add(specimen.group);
  rootGroup.add(relief.group);
  scene.add(rootGroup);

  const applyMode = (mode) => {
    currentMode = mode;
    const isSpecimen = mode === "3d-specimen";
    const isRelief = mode === "3d-relief";
    const is3d = isSpecimen || isRelief;

    specimen.group.visible = isSpecimen;
    relief.group.visible = isRelief;
    stage.setActive(is3d);
    if (is3d) {
      stage.render();
    }
  };

  applyMode(currentMode);

  const onThzMode = (e) => {
    const mode = e?.detail?.mode;
    if (mode) applyMode(mode);
  };
  document.addEventListener("thz:mode", onThzMode);

  // Subtle raycast hover over 3D specimen or relief to update #readout
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let isDragging = false;

  const onPointerDown = () => { isDragging = true; };
  const onPointerUp = () => { isDragging = false; };
  const onPointerMove = (e) => {
    if (isDragging || container.hidden) return;
    if (currentMode !== "3d-specimen" && currentMode !== "3d-relief") return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const target = currentMode === "3d-specimen" ? specimen.pickPlane : relief.surfaceMesh;
    const hits = raycaster.intersectObject(target, false);
    if (!hits.length) {
      if (readout) readout.textContent = THZ_IDLE_READOUT[currentMode];
      return;
    }

    const localPt = rootGroup.worldToLocal(hits[0].point.clone());
    const { x, y } = worldToMm(localPt.x, localPt.z);
    if (!readout) return;

    if (currentMode === "3d-specimen") {
      const hitVoid = VOIDS.find((v) => ((x - v.x) / v.rx) ** 2 + ((y - v.y) / v.ry) ** 2 <= 1.15);
      readout.textContent = hitVoid
        ? `x ${String(x).padStart(2, "0")} mm  y ${String(y).padStart(2, "0")} mm · ${hitVoid.name}`
        : `x ${String(x).padStart(2, "0")} mm  y ${String(y).padStart(2, "0")} mm · 45° infill`;
    } else {
      const val = sim.fused[y * N + x];
      readout.textContent = `x ${String(x).padStart(2, "0")} mm  y ${String(y).padStart(2, "0")} mm  norm ${val.toFixed(3)}`;
    }
  };
  const onPointerLeave = () => {
    isDragging = false;
    if (!container.hidden && readout && THZ_IDLE_READOUT[currentMode]) {
      readout.textContent = THZ_IDLE_READOUT[currentMode];
    }
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerleave", onPointerLeave, { passive: true });

  // Animate THz raster beam sweep + void interaction glow
  stage.setAnimationLoop((elapsed) => {
    if (currentMode !== "3d-specimen" || prefersReducedMotion()) return;

    const minMm = 6;
    const maxMm = 39;
    const span = maxMm - minMm;
    const period = 10.5;
    const phase = (elapsed % period) / period;
    const rows = 8;
    const rowFloat = phase * rows;
    const rowIdx = Math.floor(rowFloat);
    const rowFrac = rowFloat - rowIdx;
    const xMm = rowIdx % 2 === 0 ? minMm + rowFrac * span : maxMm - rowFrac * span;
    const yMm = minMm + ((rowIdx + 0.5) / rows) * span;

    specimen.beamGroup.position.set(mmToWorld(xMm), 0, mmToWorld(yMm));

    let beamOverVoid = 0;
    for (const va of specimen.voidAssemblies) {
      const q = ((xMm - va.def.x) / (va.def.rx * 1.25)) ** 2 + ((yMm - va.def.y) / (va.def.ry * 1.25)) ** 2;
      const proximity = Math.max(0, 1 - q);
      beamOverVoid = Math.max(beamOverVoid, proximity);
      const pulse = 0.08 * Math.sin(elapsed * 2.4 + (va.def.x > 20 ? 0 : 1.5));
      va.outerCoreMat.emissiveIntensity = va.baseEmissive + pulse + proximity * 0.7;
      va.shell.rotation.y = elapsed * 0.14;
    }
    specimen.coneMat.opacity = 0.15 + beamOverVoid * 0.16;

    // Very subtle resting breath on group when idle
    if (controls && !isDragging) {
      rootGroup.rotation.y = Math.sin(elapsed * 0.25) * 0.06;
    }
  });

  return () => {
    document.removeEventListener("thz:mode", onThzMode);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    disposeSceneResources(scene);
    stage.dispose();
  };
}

function getPlatePalette(band) {
  if (band.group === "rgb") {
    return {
      color: band.index === 2 ? PALETTE.accentLight : band.index === 3 ? PALETTE.copperGlow : PALETTE.accent,
      emissive: PALETTE.accentLight,
      baseEmissive: 0.32,
      edge: PALETTE.copperGlow,
      opacity: 0.62,
    };
  }
  if (band.group === "red-edge") {
    return {
      color: 0x524648,
      emissive: 0x8b4d2e,
      baseEmissive: 0.1,
      edge: 0xc88a62,
      opacity: 0.48,
    };
  }
  if (band.group === "nir") {
    return {
      color: 0x3c4553,
      emissive: 0x283446,
      baseEmissive: 0.07,
      edge: 0x8e9fb5,
      opacity: 0.46,
    };
  }
  if (band.group === "coastal") {
    return {
      color: 0x3e4b5d,
      emissive: 0x2a3b52,
      baseEmissive: 0.08,
      edge: 0x99adc7,
      opacity: 0.48,
    };
  }
  return {
    color: 0x313742,
    emissive: 0x232933,
    baseEmissive: 0.09,
    edge: 0x8590a1,
    opacity: 0.54,
  };
}

/**
 * Build the 3D Sentinel-2 13-band -> 1x1 projection (45 params) -> 3 RGB -> Frozen ResNet-50 assembly.
 */
function buildSpectralPipeline() {
  const pipeline = new THREE.Group();

  // Subtle stage baseline bar linking architecture modules
  const railGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-2.95, -0.78, 0),
    new THREE.Vector3(3.05, -0.78, 0),
  ]);
  pipeline.add(
    new THREE.Line(
      railGeo,
      new THREE.LineBasicMaterial({ color: 0x8a909a, transparent: true, opacity: 0.48 })
    )
  );

  // Bottleneck Frame: 1x1 Projection Matrix (45 params) at x = +0.16
  const projX = 0.16;
  const projGroup = new THREE.Group();
  projGroup.position.set(projX, 0, 0);

  const projFrameGeo = new THREE.BoxGeometry(0.14, 0.94, 0.86);
  const projFrameMat = new THREE.MeshPhysicalMaterial({
    color: 0x261d19,
    emissive: PALETTE.accent,
    emissiveIntensity: 0.24,
    roughness: 0.25,
    metalness: 0.2,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
  });
  projGroup.add(new THREE.Mesh(projFrameGeo, projFrameMat));
  projGroup.add(createEdgesLine(projFrameGeo, PALETTE.copperGlow, 0.94));

  // 45 luminous parameter nodes inside the 1x1 projection aperture: 3 output rows x 15 cols = 45
  const nodeGeo = new THREE.SphereGeometry(0.017, 8, 8);
  const nodeMat = new THREE.MeshBasicMaterial({ color: PALETTE.cream });
  const paramNodes = new THREE.InstancedMesh(nodeGeo, nodeMat, 45);
  const dummy = new THREE.Object3D();
  let nodeIdx = 0;
  for (let r = 0; r < 3; r++) {
    const ny = (1 - r) * 0.24;
    for (let c = 0; c < 15; c++) {
      const nz = (c - 7) * 0.048;
      dummy.position.set(0, ny, nz);
      dummy.updateMatrix();
      paramNodes.setMatrixAt(nodeIdx++, dummy.matrix);
    }
  }
  paramNodes.instanceMatrix.needsUpdate = true;
  projGroup.add(paramNodes);
  pipeline.add(projGroup);

  // Three RGB Output Channel planes at x = +1.06 .. +1.42
  const outputChannels = [
    { x: 1.06, y: 0.22, color: 0xd97343, edge: PALETTE.copperGlow },
    { x: 1.24, y: 0.0, color: 0xc49a6c, edge: PALETTE.cream },
    { x: 1.42, y: -0.22, color: 0x7b8da3, edge: 0xb4c4d8 },
  ];
  const outGeo = new THREE.BoxGeometry(0.052, 0.68, 0.62);
  outputChannels.forEach((ch) => {
    const chGroup = new THREE.Group();
    chGroup.position.set(ch.x, 0, 0);
    const mesh = new THREE.Mesh(
      outGeo,
      new THREE.MeshPhysicalMaterial({
        color: ch.color,
        emissive: ch.color,
        emissiveIntensity: 0.25,
        roughness: 0.3,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
      })
    );
    chGroup.add(mesh);
    chGroup.add(createEdgesLine(outGeo, ch.edge, 0.9));
    pipeline.add(chGroup);
  });

  // 13 Stacked 3D Spectral Band Plates (B1 .. B12) + converging projection beams
  const plateGeo = new THREE.BoxGeometry(0.052, 1.24, 1.04);
  const plateEntries = [];
  const platePickTargets = [];

  SENTINEL_BANDS.forEach((band, i) => {
    const px = -2.85 + i * 0.175;
    const style = getPlatePalette(band);

    const plateGroup = new THREE.Group();
    plateGroup.position.set(px, 0, 0);

    const mat = new THREE.MeshPhysicalMaterial({
      color: style.color,
      emissive: style.emissive,
      emissiveIntensity: style.baseEmissive,
      roughness: 0.28,
      metalness: 0.1,
      transparent: true,
      opacity: style.opacity,
      clearcoat: 0.35,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(plateGeo, mat);
    mesh.userData.bandIndex = i;
    plateGroup.add(mesh);
    platePickTargets.push(mesh);

    const edgeLines = createEdgesLine(plateGeo, style.edge, band.group === "rgb" ? 0.94 : 0.76);
    plateGroup.add(edgeLines);

    const ridgeGeo = new THREE.BoxGeometry(0.06, 0.032, band.group === "rgb" ? 0.46 : 0.22);
    const ridgeMat = new THREE.MeshBasicMaterial({
      color: band.group === "rgb" ? PALETTE.cream : style.edge,
      transparent: true,
      opacity: band.group === "rgb" ? 0.92 : 0.58,
    });
    const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
    ridge.position.y = 0.638;
    plateGroup.add(ridge);

    pipeline.add(plateGroup);

    const beamVerts = [];
    const pz = ((i - 6) / 6) * 0.22;
    outputChannels.forEach((ch) => {
      beamVerts.push(px + 0.03, 0, pz, projX, ch.y, pz * 0.45);
      beamVerts.push(projX, ch.y, pz * 0.45, ch.x - 0.03, 0, 0);
    });
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", new THREE.Float32BufferAttribute(beamVerts, 3));
    const beamMat = new THREE.LineBasicMaterial({
      color: band.group === "rgb" ? PALETTE.copperGlow : 0x8e9fb5,
      transparent: true,
      opacity: band.group === "rgb" ? 0.38 : 0.18,
    });
    pipeline.add(new THREE.LineSegments(beamGeo, beamMat));

    plateEntries.push({
      band,
      style,
      plateGroup,
      mat,
      edgeLines,
      beamGeo,
      beamMat,
      px,
      pz,
      currentLift: 0,
    });
  });

  // Stylized Frozen ResNet-50 residual block stack at x = +1.98 .. +2.93
  const resnetStages = [
    { x: 1.98, w: 0.16, h: 0.86, d: 0.72 },
    { x: 2.24, w: 0.18, h: 0.72, d: 0.60 },
    { x: 2.52, w: 0.20, h: 0.58, d: 0.48 },
    { x: 2.82, w: 0.22, h: 0.44, d: 0.36 },
  ];
  const resnetMat = new THREE.MeshPhysicalMaterial({
    color: 0x282e38,
    emissive: 0x1b2430,
    emissiveIntensity: 0.28,
    roughness: 0.4,
    metalness: 0.22,
    transparent: true,
    opacity: 0.82,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  resnetStages.forEach((st, idx) => {
    const bGeo = new THREE.BoxGeometry(st.w, st.h, st.d);
    const block = new THREE.Mesh(bGeo, resnetMat);
    block.position.set(st.x, 0, 0);
    pipeline.add(block);

    const bEdgeGeo = new THREE.BoxGeometry(st.w + 0.003, st.h + 0.003, st.d + 0.003);
    const edges = createEdgesLine(bEdgeGeo, 0x92a4bc, 0.82);
    edges.position.set(st.x, 0, 0);
    pipeline.add(edges);

    const prevX = idx === 0 ? outputChannels[2].x + 0.03 : resnetStages[idx - 1].x + resnetStages[idx - 1].w * 0.5;
    const nextX = st.x - st.w * 0.5;
    const linkGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(prevX, 0, 0),
      new THREE.Vector3(nextX, 0, 0),
    ]);
    pipeline.add(
      new THREE.Line(
        linkGeo,
        new THREE.LineBasicMaterial({ color: 0x98acc4, transparent: true, opacity: 0.56 })
      )
    );

    if (idx < resnetStages.length - 1) {
      const next = resnetStages[idx + 1];
      const arcCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(st.x, st.h * 0.5, 0),
        new THREE.Vector3((st.x + next.x) * 0.5, st.h * 0.5 + 0.22, 0),
        new THREE.Vector3(next.x, next.h * 0.5, 0)
      );
      const arcGeo = new THREE.BufferGeometry().setFromPoints(arcCurve.getPoints(16));
      pipeline.add(
        new THREE.Line(
          arcGeo,
          new THREE.LineBasicMaterial({ color: PALETTE.copperGlow, transparent: true, opacity: 0.54 })
        )
      );
    }
  });

  const headTip = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.09, 0),
    new THREE.MeshStandardMaterial({
      color: PALETTE.copperGlow,
      emissive: PALETTE.accentLight,
      emissiveIntensity: 0.65,
      roughness: 0.25,
    })
  );
  headTip.position.set(3.08, 0, 0);
  pipeline.add(headTip);

  const pulseGeo = new THREE.SphereGeometry(0.026, 10, 10);
  const pulseMat = new THREE.MeshBasicMaterial({ color: PALETTE.cream });
  const pulses = [0, 1, 2].map((k) => {
    const m = new THREE.Mesh(pulseGeo, pulseMat);
    m.userData.channel = k;
    pipeline.add(m);
    return m;
  });

  return { pipeline, projX, projFrameMat, outputChannels, plateEntries, platePickTargets, headTip, pulses };
}

/**
 * Initialize Stage 2: 3D Sentinel-2 Multispectral Projection Cube (#spectral-3d).
 */
function initSpectralStage() {
  const container = document.getElementById("spectral-3d");
  const wrap = document.getElementById("spectral-wrap") || container?.closest(".spectral-showcase") || document;
  const readout = document.getElementById("spectral-readout");
  const pills = [...wrap.querySelectorAll(".bands li[data-band-index]")];

  let hoveredBand = null;
  let rayHoveredBand = null;
  let lockedBand = null;
  let onStateChange = () => {};

  const getEffectiveBand = () => hoveredBand ?? rayHoveredBand ?? lockedBand;

  const syncDomReadoutAndPills = () => {
    const active = getEffectiveBand();
    const highlightedPillIndex = lockedBand ?? rayHoveredBand;

    pills.forEach((li) => {
      const idx = Number(li.dataset.bandIndex);
      li.classList.toggle("is-active", highlightedPillIndex === idx);
    });

    if (readout) {
      if (active !== null && SENTINEL_BANDS[active]) {
        const b = SENTINEL_BANDS[active];
        readout.textContent = `${b.code} · ${b.nm} nm · ${b.region} · 1×1 conv → 3 ch`;
      } else {
        readout.textContent = SPECTRAL_IDLE_READOUT;
      }
    }
    onStateChange();
  };

  // Always bind pill interactivity so readout & active state work even without WebGL
  pills.forEach((li) => {
    const idx = Number(li.dataset.bandIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= SENTINEL_BANDS.length) return;

    li.addEventListener("pointerenter", () => {
      hoveredBand = idx;
      syncDomReadoutAndPills();
    });
    li.addEventListener("pointerleave", () => {
      if (hoveredBand === idx) hoveredBand = null;
      syncDomReadoutAndPills();
    });
    li.addEventListener("focus", () => {
      hoveredBand = idx;
      syncDomReadoutAndPills();
    });
    li.addEventListener("blur", () => {
      if (hoveredBand === idx) hoveredBand = null;
      syncDomReadoutAndPills();
    });
    li.addEventListener("click", () => {
      lockedBand = lockedBand === idx ? null : idx;
      syncDomReadoutAndPills();
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        lockedBand = lockedBand === idx ? null : idx;
        syncDomReadoutAndPills();
      } else if (e.key === "Escape" && lockedBand !== null) {
        lockedBand = null;
        syncDomReadoutAndPills();
      }
    });
  });

  if (!container) return null;

  const stage = createStage(container, {
    orbit: true,
    fov: 34,
    cameraPos: [0.35, 1.42, 6.25],
    target: [0.05, 0.04, 0],
    minPolarAngle: 0.35,
    maxPolarAngle: Math.PI * 0.62,
    minAzimuthAngle: -Math.PI * 0.45,
    maxAzimuthAngle: Math.PI * 0.45,
  });
  if (!stage.isSupported) return null;

  const { scene, camera, renderer } = stage;

  // Responsive FOV fit so all 13 bands + ResNet stack stay framed on narrow & wide screens
  const fitCameraFov = (aspect) => {
    if (!aspect || !Number.isFinite(aspect)) return;
    const reqFov = THREE.MathUtils.radToDeg(2 * Math.atan(3.55 / (6.2 * Math.max(aspect, 0.9))));
    camera.fov = Math.max(33, Math.min(48, reqFov));
    camera.updateProjectionMatrix();
  };
  fitCameraFov(camera.aspect);
  stage.onResize((_w, _h, aspect) => fitCameraFov(aspect));

  // Lighting
  scene.add(new THREE.AmbientLight(0xd8dde8, 0.78));
  scene.add(new THREE.HemisphereLight(PALETTE.cream, 0x0d0f13, 0.58));
  const key = new THREE.DirectionalLight(PALETTE.cream, 1.8);
  key.position.set(2.5, 6.0, 5.2);
  scene.add(key);
  const warmRim = new THREE.DirectionalLight(PALETTE.copperGlow, 1.25);
  warmRim.position.set(-5.2, 2.2, 2.8);
  scene.add(warmRim);
  const coolFill = new THREE.DirectionalLight(0x94a6be, 0.72);
  coolFill.position.set(5.4, -1.6, -4.0);
  scene.add(coolFill);

  const {
    pipeline,
    projX,
    projFrameMat,
    outputChannels,
    plateEntries,
    platePickTargets,
    headTip,
    pulses,
  } = buildSpectralPipeline();
  scene.add(pipeline);

  const applyVisualTargets = (dt) => {
    const active = getEffectiveBand();
    const instant = dt <= 0 || prefersReducedMotion();
    const alpha = instant ? 1 : 1 - Math.exp(-12 * dt);

    plateEntries.forEach((entry, i) => {
      const isTarget = active === i;
      const isDimmed = active !== null && !isTarget;
      const targetLift = isTarget ? 0.26 : 0;

      entry.currentLift += (targetLift - entry.currentLift) * alpha;
      entry.plateGroup.position.y = entry.currentLift;
      const s = 1 + (entry.currentLift / 0.26) * 0.055;
      entry.plateGroup.scale.setScalar(s);

      // Keep converging beam origin coupled to lifted plate Y
      const posAttr = entry.beamGeo.attributes.position;
      for (let c = 0; c < 3; c++) {
        posAttr.setY(c * 4, entry.currentLift);
      }
      posAttr.needsUpdate = true;

      if (isTarget) {
        entry.mat.opacity = 0.88;
        entry.mat.emissiveIntensity = 0.72;
        entry.edgeLines.material.color.setHex(PALETTE.cream);
        entry.edgeLines.material.opacity = 1.0;
        entry.beamMat.color.setHex(PALETTE.cream);
        entry.beamMat.opacity = 0.9;
      } else if (isDimmed) {
        entry.mat.opacity = entry.style.opacity * 0.62;
        entry.mat.emissiveIntensity = entry.style.baseEmissive * 0.55;
        entry.edgeLines.material.color.setHex(entry.style.edge);
        entry.edgeLines.material.opacity = 0.42;
        entry.beamMat.color.setHex(entry.band.group === "rgb" ? PALETTE.copperGlow : 0x7e8ea4);
        entry.beamMat.opacity = 0.08;
      } else {
        entry.mat.opacity = entry.style.opacity;
        entry.mat.emissiveIntensity = entry.style.baseEmissive;
        entry.edgeLines.material.color.setHex(entry.style.edge);
        entry.edgeLines.material.opacity = entry.band.group === "rgb" ? 0.94 : 0.76;
        entry.beamMat.color.setHex(entry.band.group === "rgb" ? PALETTE.copperGlow : 0x8e9fb5);
        entry.beamMat.opacity = entry.band.group === "rgb" ? 0.38 : 0.18;
      }
    });

    projFrameMat.emissiveIntensity = active !== null ? 0.44 : 0.24;
  };

  onStateChange = () => {
    if (prefersReducedMotion()) {
      applyVisualTargets(0);
    }
    stage.render();
  };

  // Raycast hover/click directly on the 13 spectral plates
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerDownXY = null;
  let isDragging = false;

  const pickPlate = (clientX, clientY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(platePickTargets, false);
    return hits.length ? hits[0].object.userData.bandIndex : null;
  };

  const onPointerDown = (e) => {
    isDragging = true;
    pointerDownXY = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e) => {
    if (isDragging) return;
    const hitIdx = pickPlate(e.clientX, e.clientY);
    renderer.domElement.style.cursor = hitIdx !== null ? "pointer" : "grab";
    if (hitIdx !== rayHoveredBand) {
      rayHoveredBand = hitIdx;
      syncDomReadoutAndPills();
    }
  };
  const onPointerUp = (e) => {
    const down = pointerDownXY;
    isDragging = false;
    pointerDownXY = null;
    if (!down) return;
    const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (dist > 6) return;

    const hitIdx = pickPlate(e.clientX, e.clientY);
    if (hitIdx !== null) {
      lockedBand = lockedBand === hitIdx ? null : hitIdx;
    } else if (lockedBand !== null) {
      lockedBand = null;
    }
    syncDomReadoutAndPills();
  };
  const onPointerLeave = () => {
    isDragging = false;
    pointerDownXY = null;
    renderer.domElement.style.cursor = "grab";
    if (rayHoveredBand !== null) {
      rayHoveredBand = null;
      syncDomReadoutAndPills();
    }
  };

  renderer.domElement.addEventListener("pointerdown", onPointerDown, { passive: true });
  renderer.domElement.addEventListener("pointermove", onPointerMove, { passive: true });
  renderer.domElement.addEventListener("pointerup", onPointerUp, { passive: true });
  renderer.domElement.addEventListener("pointerleave", onPointerLeave, { passive: true });

  // Animation loop: smooth plate lifts, projection pulses, subtle ResNet head rotation
  stage.setAnimationLoop((elapsed, delta) => {
    applyVisualTargets(delta);

    if (prefersReducedMotion()) {
      pulses.forEach((p) => { p.visible = false; });
      return;
    }

    const active = getEffectiveBand();
    const srcEntry = active !== null ? plateEntries[active] : plateEntries[2];

    pulses.forEach((p, chIdx) => {
      p.visible = true;
      const t = (elapsed * 0.45 + chIdx * 0.33) % 1;
      const ch = outputChannels[chIdx];
      if (t < 0.5) {
        const u = t / 0.5;
        p.position.set(
          THREE.MathUtils.lerp(srcEntry.px + 0.03, projX, u),
          THREE.MathUtils.lerp(srcEntry.currentLift, ch.y, u),
          THREE.MathUtils.lerp(srcEntry.pz, srcEntry.pz * 0.45, u)
        );
      } else {
        const u = (t - 0.5) / 0.5;
        p.position.set(
          THREE.MathUtils.lerp(projX, ch.x - 0.03, u),
          THREE.MathUtils.lerp(ch.y, 0, u),
          THREE.MathUtils.lerp(srcEntry.pz * 0.45, 0, u)
        );
      }
    });

    headTip.rotation.y = elapsed * 0.7;
    headTip.rotation.x = Math.sin(elapsed * 0.9) * 0.2;
    pipeline.rotation.y = Math.sin(elapsed * 0.22) * 0.035;
  });

  return () => {
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
    disposeSceneResources(scene);
    stage.dispose();
  };
}

function initResearchScenes() {
  const cleanups = [initThzStage(), initSpectralStage()].filter(Boolean);
  if (cleanups.length) {
    window.addEventListener("pagehide", (e) => {
      if (!e.persisted) {
        cleanups.forEach((fn) => fn());
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initResearchScenes, { once: true });
} else {
  initResearchScenes();
}
