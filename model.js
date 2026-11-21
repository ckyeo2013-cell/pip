/*
 * Pip the sugar glider: pure geometry + pose module.
 * Builds a list of ellipsoid "parts" (centre, radii, rotation, colour) for a
 * given animation state. The renderer in content.js draws them with WebGL.
 *
 * Matrices are 3x3, column-major: m[col*3 + row].
 * Coordinates: +x right, +y up, +z toward the viewer. The creature faces +z.
 */
(function (root) {
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  const mul = (a, b) => {
    const o = new Array(9);
    for (let c = 0; c < 3; c++)
      for (let r = 0; r < 3; r++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += a[k * 3 + r] * b[c * 3 + k];
        o[c * 3 + r] = s;
      }
    return o;
  };
  const apply = (m, v) => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
  const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
  const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };

  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
  const norm = (v) => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // rotation whose local +y axis points along d (used to lay an ellipsoid along a limb)
  const basisFromY = (d) => {
    const y = norm(d);
    const a = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
    const x = norm(cross(a, y));
    const z = cross(x, y);
    return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
  };

  const COMMON = {
    eye: [0.025, 0.02, 0.025],
    white: [1, 1, 1],
    mouth: [0.4, 0.26, 0.28],
  };
  // Natural sugar-glider colourways (names kept so saved settings still work).
  const PALETTES = {
    classic: Object.assign({
      fur: [0.6, 0.61, 0.65], dark: [0.17, 0.16, 0.19], belly: [0.92, 0.89, 0.83], cheek: [0.88, 0.85, 0.79],
      membrane: [0.55, 0.56, 0.6], edge: [0.28, 0.28, 0.32], earOut: [0.72, 0.62, 0.64], earIn: [0.87, 0.72, 0.72],
      nose: [0.79, 0.54, 0.58], feet: [0.83, 0.66, 0.64],
    }, COMMON),
    snow: Object.assign({
      fur: [0.93, 0.94, 0.96], dark: [0.25, 0.25, 0.3], belly: [1, 0.98, 0.95], cheek: [0.98, 0.9, 0.9],
      membrane: [0.82, 0.84, 0.9], edge: [0.5, 0.52, 0.6], earOut: [0.9, 0.78, 0.8], earIn: [0.98, 0.82, 0.84],
      nose: [0.9, 0.55, 0.62], feet: [0.95, 0.8, 0.8],
    }, COMMON),
    midnight: Object.assign({
      fur: [0.2, 0.22, 0.36], dark: [0.07, 0.07, 0.13], belly: [0.55, 0.58, 0.75], cheek: [0.5, 0.52, 0.7],
      membrane: [0.17, 0.19, 0.32], edge: [0.08, 0.09, 0.18], earOut: [0.34, 0.3, 0.5], earIn: [0.62, 0.5, 0.7],
      nose: [0.75, 0.5, 0.65], feet: [0.4, 0.38, 0.55],
    }, COMMON),
    sakura: Object.assign({
      fur: [0.94, 0.74, 0.8], dark: [0.35, 0.18, 0.24], belly: [1, 0.93, 0.93], cheek: [0.98, 0.82, 0.86],
      membrane: [0.88, 0.62, 0.7], edge: [0.5, 0.3, 0.38], earOut: [0.92, 0.6, 0.7], earIn: [1, 0.8, 0.86],
      nose: [0.85, 0.4, 0.52], feet: [0.96, 0.7, 0.76],
    }, COMMON),
    mint: Object.assign({
      fur: [0.6, 0.82, 0.72], dark: [0.12, 0.25, 0.2], belly: [0.93, 0.97, 0.9], cheek: [0.88, 0.95, 0.86],
      membrane: [0.48, 0.7, 0.6], edge: [0.2, 0.38, 0.32], earOut: [0.7, 0.78, 0.7], earIn: [0.88, 0.8, 0.8],
      nose: [0.78, 0.52, 0.56], feet: [0.8, 0.78, 0.7],
    }, COMMON),
    lavender: Object.assign({
      fur: [0.72, 0.64, 0.86], dark: [0.22, 0.16, 0.32], belly: [0.95, 0.92, 0.97], cheek: [0.93, 0.86, 0.95],
      membrane: [0.6, 0.52, 0.76], edge: [0.32, 0.25, 0.46], earOut: [0.78, 0.62, 0.78], earIn: [0.92, 0.76, 0.86],
      nose: [0.8, 0.5, 0.64], feet: [0.84, 0.7, 0.8],
    }, COMMON),
    honey: Object.assign({
      fur: [0.8, 0.62, 0.43], dark: [0.3, 0.2, 0.14], belly: [0.96, 0.91, 0.8], cheek: [0.94, 0.87, 0.74],
      membrane: [0.7, 0.53, 0.37], edge: [0.4, 0.28, 0.19], earOut: [0.78, 0.58, 0.52], earIn: [0.9, 0.7, 0.66],
      nose: [0.8, 0.54, 0.54], feet: [0.86, 0.67, 0.62],
    }, COMMON),
    cocoa: Object.assign({
      fur: [0.46, 0.36, 0.32], dark: [0.13, 0.1, 0.09], belly: [0.87, 0.81, 0.73], cheek: [0.82, 0.75, 0.67],
      membrane: [0.4, 0.31, 0.27], edge: [0.2, 0.15, 0.13], earOut: [0.56, 0.44, 0.43], earIn: [0.76, 0.58, 0.57],
      nose: [0.65, 0.42, 0.44], feet: [0.72, 0.55, 0.52],
    }, COMMON),
  };

  // Where the arm and leg end for one side: tucked against the body at rest,
  // reaching out like a kite when gliding (g = 0..1).
  function limbPose(s, g, wave) {
    const w = wave || 0;
    return {
      sh: [s * 0.36, 0.2, 0.14],
      hip: [s * lerp(0.3, 0.4, g), lerp(-0.42, -0.34, g), lerp(0, -0.25, g)],
      wr: [s * lerp(0.4, 1.3, g) + s * w * 0.15 * (1 - g), lerp(-0.12, 0.32, g) + w * 0.2 * (1 - g), lerp(0.3, 0.36, g)],
      an: [s * lerp(0.3, 1.1, g), lerp(-0.62, -0.5, g), lerp(0.1, -0.2, g)],
    };
  }
  // The gliding membrane: a sheet from the body edge (v=0) out to the wrist-ankle edge (v=1),
  // u runs front (shoulder/wrist) to back (hip/ankle).
  function memSurface(L, s, g, t, u, v) {
    const bx = lerp(L.sh[0], L.hip[0], u), by = lerp(L.sh[1], L.hip[1], u), bz = lerp(L.sh[2], L.hip[2], u);
    const ox = lerp(L.wr[0], L.an[0], u), oy = lerp(L.wr[1], L.an[1], u), oz = lerp(L.wr[2], L.an[2], u);
    const su = Math.sin(Math.PI * u), sv = Math.sin(Math.PI * v);
    return [
      lerp(bx, ox, v) + s * (1 - g) * 0.035 * sv * su - s * (0.03 + 0.06 * g) * su * Math.pow(v, 3),
      lerp(by, oy, v) - g * 0.06 * sv * su + (1 - g) * 0.008 * Math.sin(u * 14 + v * 6 + t * 1.3),
      lerp(bz, oz, v),
    ];
  }
  const MEM_NU = 12, MEM_NV = 6;

  /*
   * p: { t, bodyYaw, lookYaw, lookPitch, glide(0..1), crouch(0..1), blink(0..1 open),
   *      happy(0..1), thinking(0..1), palette }
   */
  function buildParts(p) {
    const parts = [];
    const C = PALETTES[p.palette] || PALETTES.classic;
    const t = p.t || 0;
    const glide = clamp(p.glide || 0, 0, 1);
    const crouch = clamp(p.crouch || 0, 0, 1);
    const happy = clamp(p.happy || 0, 0, 1);
    const thinking = clamp(p.thinking || 0, 0, 1);
    const blink = p.blink === undefined ? 1 : p.blink;

    const child = (F, off, rot) => ({
      R: rot ? mul(F.R, rot) : F.R,
      t: add(F.t, apply(F.R, off)),
    });
    const P = (F, c, r, rot, color, spec, fur) => {
      parts.push({
        c: add(apply(F.R, c), F.t),
        r,
        M: rot ? mul(F.R, rot) : F.R,
        color,
        spec: spec || 0,
        fur: fur === undefined ? 1 : fur,
      });
    };

    // ---- body ---------------------------------------------------------
    const bob = Math.sin(t * 2.2) * 0.022 * (1 - glide) + happy * Math.abs(Math.sin(t * 9)) * 0.05;
    const B = {
      R: mul(rotY(p.bodyYaw || 0), rotX(0.02 + 0.28 * glide + 0.2 * crouch)),
      t: [0, -0.41 + bob - 0.14 * crouch, 0],
    };

    P(B, [0, -0.02, 0], [0.44, 0.62, 0.4], null, C.fur);
    P(B, [0, -0.36, -0.02], [0.47, 0.3, 0.42], null, C.fur);   // hips
    P(B, [0, 0.42, 0.04], [0.36, 0.3, 0.34], null, C.fur);     // shoulders and neck
    P(B, [0, -0.08, 0.2], [0.29, 0.5, 0.24], null, C.belly);
    P(B, [0, 0.1, -0.4], [0.06, 0.44, 0.14], null, C.dark); // back stripe

    // ---- limbs and the gliding membrane (one side at a time) -----------
    for (const s of [-1, 1]) {
      const wave = s === 1 ? happy * Math.sin(t * 12) * 0.25 : 0;
      const L = limbPose(s, glide, wave);
      const limb = (a, b, r, color) => {
        const d = sub(b, a);
        P(B, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [r, len3(d) / 2, r], basisFromY(d), color);
      };
      limb(L.sh, L.wr, 0.08, C.fur);   // arm
      limb(L.hip, L.an, 0.11, C.fur);  // leg
      P(B, [L.hip[0] * 0.95, L.hip[1] + 0.02, L.hip[2] + 0.02], [0.16, 0.24, 0.19], null, C.fur); // thigh
      P(B, L.wr, [0.055, 0.05, 0.065], null, C.feet, 0, 0.4); // small hand
      P(B, [L.an[0], L.an[1] - 0.02, L.an[2] + 0.07], [0.1, 0.05, 0.19], rotY(s * 0.15), C.feet, 0, 0.4); // foot

      for (let i = 0; i < MEM_NU; i++) {
        for (let j = 0; j < MEM_NV; j++) {
          const u = (i + 0.5) / MEM_NU, v = (j + 0.5) / MEM_NV;
          const c = memSurface(L, s, glide, t, u, v);
          const tu = sub(memSurface(L, s, glide, t, u + 0.01, v), memSurface(L, s, glide, t, u - 0.01, v)).map((x) => x / 0.02);
          const tv = sub(memSurface(L, s, glide, t, u, v + 0.01), memSurface(L, s, glide, t, u, v - 0.01)).map((x) => x / 0.02);
          const xa = norm(tu);
          const n = norm(cross(tu, tv));
          const za = cross(xa, n);
          const col = v < 0.5 ? mix3(C.fur, C.membrane, v * 2 * (0.3 + 0.7 * glide)) : mix3(mix3(C.fur, C.membrane, 0.3 + 0.7 * glide), C.edge, Math.pow((v - 0.5) * 2, 1.6) * (0.15 + 0.85 * glide));
          P(B, c, [(len3(tu) / MEM_NU) * 0.95, 0.03, (len3(tv) / MEM_NV) * 0.95],
            [xa[0], xa[1], xa[2], n[0], n[1], n[2], za[0], za[1], za[2]], col, 0, 1);
          parts[parts.length - 1].shell = false; // thin sheet: no fur layers
        }
      }
    }

    // ---- tail ---------------------------------------------------------
    const tailAmp = 0.14 + 0.25 * thinking + happy * 0.1;
    const tailSpd = 1.5 + thinking * 3 + happy * 2;
    for (let i = 0; i < 28; i++) {
      const u = i / 27;
      const sway = Math.sin(t * tailSpd - u * 2.6) * tailAmp * u;
      const rest = [0.08 + 0.55 * Math.pow(u, 1.5) + sway, -0.4 + 0.75 * Math.pow(u, 1.4), -0.35 - 0.85 * u];
      const gld = [sway * 0.5, -0.3 - 0.1 * u, -0.4 - 1.4 * u];
      const pos = [lerp(rest[0], gld[0], glide), lerp(rest[1], gld[1], glide), lerp(rest[2], gld[2], glide)];
      const rad = 0.17 + 0.08 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85) - 0.05 * u * u;
      const col = u > 0.72 ? mix3(C.fur, C.dark, clamp((u - 0.72) / 0.2, 0, 1)) : C.fur;
      P(B, pos, [rad, rad, rad * 1.4], null, col);
    }

    // ---- head ---------------------------------------------------------
    const headYaw = clamp((p.lookYaw || 0) - (p.bodyYaw || 0) * 0.65, -0.9, 0.9);
    const headRot = mul(
      mul(rotY(headYaw), rotX(-(p.lookPitch || 0) - glide * 0.25 - crouch * 0.1)),
      rotZ(0.05 + thinking * 0.25 + Math.sin(t * 1.3) * 0.03 + happy * Math.sin(t * 8) * 0.06)
    );
    const H = child(B, [0, 0.66, 0.1], headRot);

    P(H, [0, 0, 0], [0.55, 0.5, 0.52], null, C.fur);
    P(H, [0, -0.1, 0.4], [0.17, 0.15, 0.3], rotX(-0.12), C.cheek); // pointed muzzle
    P(H, [0, 0.2, 0.3], [0.04, 0.3, 0.32], rotX(-0.3), C.dark); // nose-to-crown stripe
    P(H, [0, 0.36, -0.1], [0.05, 0.2, 0.3], rotX(0.5), C.dark);

    const eyeOpen = clamp(Math.min(blink, 1 - 0.8 * happy), 0, 1);
    for (const s of [-1, 1]) {
      P(H, [s * 0.3, -0.15, 0.3], [0.1, 0.09, 0.12], null, C.cheek);
      P(H, [s * 0.3, 0.07, 0.3], [0.2, lerp(0.05, 0.23, eyeOpen), 0.13], null, C.dark); // dark eye patch
      P(H, [s * 0.31, 0.07, 0.35], [0.155, lerp(0.02, 0.19, eyeOpen), 0.12], null, C.eye, 1.0, 0);
      if (eyeOpen > 0.5) {
        P(H, [s * 0.27, 0.15, 0.45], [0.05, 0.055, 0.025], null, C.white, 1.0, 0);
        P(H, [s * 0.36, 0.01, 0.43], [0.02, 0.022, 0.015], null, C.white, 1.0, 0);
      }
      P(H, [s * 0.04, -0.2, 0.6], [0.04, 0.011, 0.03], rotZ(s * 0.45), C.mouth, 0, 0); // mouth line

      // ears: big, thin, pinkish-grey
      const wig = Math.sin(t * (thinking > 0.1 ? 9 : 1.1) + s) * (thinking > 0.1 ? 0.1 : 0.05)
        + happy * Math.sin(t * 14 + s) * 0.08;
      const E = child(H, [s * 0.36, 0.36, -0.02], rotZ(-s * 0.5 + s * wig));
      P(E, [0, 0.14, 0], [0.22, 0.4, 0.04], null, C.earOut, 0, 0.5);
      P(E, [0, 0.12, 0.03], [0.15, 0.32, 0.03], null, C.earIn, 0, 0.3);
    }
    P(H, [0, -0.1, 0.69], [0.05, 0.04, 0.04], null, C.nose, 0.6, 0.3);

    return parts;
  }

  const api = { buildParts, PALETTES, mul, apply, rotX, rotY, rotZ };
  root.GliderModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
