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

  const COMMON = {
    eye: [0.06, 0.05, 0.08],
    white: [1, 1, 1],
    nose: [0.93, 0.56, 0.63],
    earIn: [0.97, 0.75, 0.79],
    blush: [1.0, 0.68, 0.72],
    mouth: [0.42, 0.26, 0.29],
    feet: [0.96, 0.79, 0.77],
  };
  const PALETTES = {
    classic: Object.assign({
      fur: [0.62, 0.67, 0.76], dark: [0.33, 0.36, 0.46],
      belly: [0.98, 0.94, 0.89], membrane: [0.72, 0.76, 0.84],
    }, COMMON),
    honey: Object.assign({
      fur: [0.87, 0.67, 0.43], dark: [0.52, 0.34, 0.22],
      belly: [1.0, 0.95, 0.85], membrane: [0.93, 0.77, 0.56],
    }, COMMON),
    cocoa: Object.assign({
      fur: [0.56, 0.43, 0.37], dark: [0.27, 0.19, 0.17],
      belly: [0.96, 0.89, 0.82], membrane: [0.66, 0.53, 0.46],
    }, COMMON),
  };

  /*
   * p: { t, bodyYaw, lookYaw, lookPitch, glide(0..1), blink(0..1 open),
   *      happy(0..1), thinking(0..1), palette }
   */
  function buildParts(p) {
    const parts = [];
    const C = PALETTES[p.palette] || PALETTES.classic;
    const t = p.t || 0;
    const glide = clamp(p.glide || 0, 0, 1);
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
    const bob = Math.sin(t * 2.2) * 0.025 * (1 - glide) + happy * Math.abs(Math.sin(t * 9)) * 0.05;
    const B = {
      R: mul(rotY(p.bodyYaw || 0), rotX(0.04 + 0.12 * glide)),
      t: [0, -0.42 + bob, 0],
    };

    P(B, [0, 0, 0], [0.62, 0.55, 0.55], null, C.fur);
    P(B, [0, -0.1, 0.27], [0.44, 0.4, 0.33], null, C.belly);
    P(B, [0, 0.1, -0.42], [0.07, 0.42, 0.16], null, C.dark); // back stripe

    const flap = Math.sin(t * 3) * 0.03 + glide * Math.sin(t * 11) * 0.04;
    for (const s of [-1, 1]) {
      // feet
      P(B, [s * 0.3, -0.5, 0.2], [0.17, 0.12, 0.24], rotY(s * 0.15), C.feet);
      // arms + hands
      const wave = s === 1 ? happy * Math.sin(t * 12) * 0.25 : 0;
      P(B, [s * 0.5, -0.08, 0.3], [0.11, 0.22, 0.11], rotZ(s * 0.3 + wave), C.fur);
      P(B, [s * 0.58 + wave * 0.5, -0.27 + wave * 0.15, 0.35], [0.09, 0.08, 0.09], null, C.feet);

      // glide membrane: dark rim behind, soft fur in front
      const gx = 0.6 + glide * 0.4;
      const rx = 0.1 + glide * 0.56;
      const ry = 0.44 - glide * 0.06;
      const rotM = mul(rotZ(s * (0.14 - glide * 0.14 + flap)), rotY(s * (-0.25 + glide * 0.1)));
      P(B, [s * gx, -0.1, -0.025], [rx + 0.03, ry + 0.03, 0.08], rotM, C.dark);
      P(B, [s * gx, -0.1, 0.0], [rx, ry, 0.09], rotM, C.membrane);
    }

    // ---- tail ---------------------------------------------------------
    const tailAmp = 0.18 + 0.25 * thinking + happy * 0.1;
    const tailSpd = 1.6 + thinking * 3 + happy * 2;
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      const sway = Math.sin(t * tailSpd - u * 2.4) * tailAmp * u;
      const pos = [
        0.32 * u + sway,
        -0.25 + 1.15 * u * u * (1 - glide * 0.7),
        -0.5 - 0.55 * u,
      ];
      const rad = 0.16 + 0.1 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.85);
      const col = u > 0.7 ? mixC(C.fur, C.dark, (u - 0.7) / 0.3) : C.fur;
      P(B, pos, [rad, rad, rad * 1.2], null, col);
    }

    // ---- head ---------------------------------------------------------
    const headYaw = clamp((p.lookYaw || 0) - (p.bodyYaw || 0) * 0.65, -0.9, 0.9);
    const headRot = mul(
      mul(rotY(headYaw), rotX(-(p.lookPitch || 0))),
      rotZ(thinking * 0.25 + Math.sin(t * 1.3) * 0.03 + happy * Math.sin(t * 8) * 0.06)
    );
    const H = child(B, [0, 0.76, 0.1], headRot);

    P(H, [0, 0, 0], [0.64, 0.54, 0.54], null, C.fur);
    P(H, [0, -0.12, 0.28], [0.36, 0.3, 0.26], null, C.belly); // muzzle / face mask
    P(H, [0, 0.28, 0.27], [0.06, 0.22, 0.22], null, C.dark); // head stripe

    const eyeOpen = Math.min(blink, 1 - 0.8 * happy);
    const eyeRy = lerp(0.022, 0.15, clamp(eyeOpen, 0, 1));
    for (const s of [-1, 1]) {
      P(H, [s * 0.25, 0.02, 0.44], [0.125, eyeRy, 0.1], null, C.eye, 1.0, 0);
      if (eyeOpen > 0.5) {
        P(H, [s * 0.21, 0.08, 0.53], [0.045, 0.055, 0.03], null, C.white, 1.0, 0);
        P(H, [s * 0.29, -0.05, 0.52], [0.022, 0.025, 0.02], null, C.white, 1.0, 0);
      }
      // blush
      P(H, [s * 0.38, -0.14, 0.34], [0.1, 0.065, 0.1], null, C.blush, 0, 0.5);
      // smile
      P(H, [s * 0.045, -0.2, 0.5], [0.045, 0.013, 0.03], rotZ(s * 0.45), C.mouth, 0, 0);

      // ears: outer fur + pink inner
      const wig = Math.sin(t * (thinking > 0.1 ? 9 : 1.1) + s) * (thinking > 0.1 ? 0.1 : 0.05)
        + happy * Math.sin(t * 14 + s) * 0.08;
      const E = child(H, [s * 0.4, 0.52, -0.04], rotZ(-s * 0.42 + s * wig));
      P(E, [0, 0, 0], [0.21, 0.31, 0.075], null, C.fur);
      P(E, [0, -0.02, 0.05], [0.14, 0.23, 0.05], null, C.earIn, 0, 0.5);
    }
    P(H, [0, -0.09, 0.53], [0.075, 0.055, 0.05], null, C.nose, 0.6, 0.3);

    return parts;
  }

  const api = { buildParts, PALETTES, mul, apply, rotX, rotY, rotZ };
  root.GliderModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
