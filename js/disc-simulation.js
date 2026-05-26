/* disc-simulation.js — v3
 * Scientifically motivated protoplanetary disc animation
 *
 * Key physics:
 *   - Keplerian shear: ω ∝ r^-1.5
 *   - 11 rings: magnetospheric cavity, dust sublimation rim, B/D substructure
 *   - Inner disc rendered as continuous glowing ellipse bands (not sparse dots)
 *   - Magnetospheric accretion funnels: start at inner disc rim (r = R_trunc,  z=0)
 *     arc along dipole field-line geometry, terminate at stellar POLES (z = ±R★)
 *   - T Tauri star: limb darkening, p-mode + breathing pulsation, polar hot-spots
 *   - Bipolar micro-jet along rotation axis
 */
(function () {
  const canvas = document.getElementById('disc-canvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const parent = canvas.parentElement;

  let W, H, cx, cy;
  let targetTX = 0, targetTY = 0, tiltX = 0, tiltY = 0;
  let t = 0;

  /* ─── resize ──────────────────────────────────────────────────── */
  function resize() {
    W  = canvas.width  = parent.clientWidth  || window.innerWidth;
    H  = canvas.height = parent.clientHeight || window.innerHeight;
    cx = W / 2;
    cy = H / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', e => {
    targetTX = (e.clientX / window.innerWidth  - 0.5) * 0.15;
    targetTY = (e.clientY / window.innerHeight - 0.5) * 0.10;
  });

  /* ─── background stars ────────────────────────────────────────── */
  const bgStars = Array.from({ length: 280 }, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.2 + 0.15,
    ph: Math.random() * Math.PI * 2,
    sp: 0.3 + Math.random() * 0.5,
    warm: Math.random()
  }));

  /* ─── 3-D projection ──────────────────────────────────────────── */
  // Disc is inclined ~18° to line of sight (inc ≈ 0.32 rad).
  // Interactive mouse tilt adds ±tiltY to inclination, ±tiltX to azimuth.
  // z is height above/below disc midplane (rotation axis = screen vertical).
  function project3D(angle, r, z) {
    const inc = 0.32 + tiltY * 0.42;
    return {
      x:     cx + Math.cos(angle) * r + tiltX * r * 0.22,
      y:     cy + Math.sin(angle) * r * inc - z,
      depth: Math.sin(angle) * r + z * 0.6   // painter's algorithm depth key
    };
  }

  /* ─── Keplerian angular velocity ─────────────────────────────── */
  const R0 = 100, W0 = 0.00140;
  function keplerSpd(r) { return W0 * Math.pow(R0 / r, 1.5); }

  /* ─── disc ring definitions ───────────────────────────────────────────────
   * Rings r < 90 are "inner disc" — rendered as continuous ellipse bands
   * in drawInnerDisc(), not as particle clouds.
   * Rings r ≥ 90 are mid/outer disc rendered as particle clouds.
   * ──────────────────────────────────────────────────────────────────────── */
  const INNER_BANDS = [
    // r, half-width, rgba colour at full opacity
    { r: 30, hw: 3,  rgba: [255, 220, 150], peak: 0.55 },  // very inner rim
    { r: 38, hw: 4,  rgba: [255, 210, 130], peak: 0.75 },  // dust sublimation front
    { r: 50, hw: 5,  rgba: [252, 198, 115], peak: 0.70 },  // B1 inner
    
    
    { r: 80, hw: 4,  rgba: [225, 160,  82], peak: 0.48 },  // B2 outer
  ];

  const OUTER_RINGS = [
    // D2 gap — very sparse
    { r: 81, spread: 6,  n:  60, color: p => `rgba(200,155, 80,${0.13 * p.br})` },
    // B3
    { r: 120, spread: 7,  n: 360, color: p => `rgba(225,172, 95,${0.55 * p.br})` },
    // D4 gap
    { r: 145, spread: 6,  n:  65, color: p => `rgba(185,145, 80,${0.12 * p.br})` },
    // B4
    { r: 168, spread: 8,  n: 400, color: p => `rgba(210,160, 88,${0.50 * p.br})` },
    // D5 broad gap
    { r: 197, spread: 7,  n:  55, color: p => `rgba(170,135, 75,${0.11 * p.br})` },
    // B5
    { r: 222, spread: 10, n: 440, color: p => `rgba(185,148, 85,${0.40 * p.br})` },
    // B6
    { r: 262, spread: 12, n: 460, color: p => `rgba(165,138, 90,${0.30 * p.br})` },
    // Diffuse outer disc / remnant envelope
    { r: 308, spread: 22, n: 500, color: p => `rgba(140,120, 85,${0.13 * p.br})` },
  ];

  OUTER_RINGS.forEach(ring => {
    ring.spd = keplerSpd(ring.r);
    ring.pts = Array.from({ length: ring.n }, () => ({
      angle:  Math.random() * Math.PI * 2,
      dR:     (Math.random() - 0.3) * ring.spread,
      sz:     Math.random() * 1.5 + 0.3,
      br:     0.15 + Math.random() * 0.65,
      dAngle: (Math.random() - 0.5) * 0.000012
    }));
  });

  // Each inner band also has a slow Keplerian drift angle for the texture
  INNER_BANDS.forEach(b => { b.angle = 0; b.spd = keplerSpd(b.r); });

  /* ─── scattered-light haze ────────────────────────────────────── */
  const haze = Array.from({ length: 400 }, () => {
    const r = 35 + Math.random() * 290;
    return { angle: Math.random() * Math.PI * 2, r,
             sz: Math.random() * 0.7 + 0.1,
             alpha: Math.random() * 0.05,
             spd: keplerSpd(r) * 0.35 };
  });

  /* ─── magnetospheric accretion funnels ────────────────────────────────────
   *
   * Physical picture:
   *   The stellar magnetic dipole (nearly aligned with rotation axis) truncates
   *   the disc at R_trunc.  Gas is lifted off the disc midplane and channelled
   *   along field lines that arch from (R_trunc, z=0) to the STELLAR POLE
   *   at (0, z = ±R★ in 3-D, i.e. directly above/below the star centre).
   *
   * Geometry implemented here:
   *   P_start  = project3D(discAngle, R_TRUNC, 0)      ← inner disc rim, midplane
   *   P_end    = pole position projected onto screen    ← directly above/below star
   *   Control  = project3D(discAngle*0.5, R_TRUNC*0.3, poleZ*0.6)
   *              (pulled inward and upward, mimicking dipole field line curvature)
   *
   * Each funnel co-rotates with the magnetosphere at the stellar rotation rate.
   * We place 2 funnels per pole (4 total), separated by ~π in azimuth, which is
   * the typical two-armed accretion geometry seen in MHD simulations.
   * ──────────────────────────────────────────────────────────────────────── */

  const R_TRUNC  = 38;   // magnetospheric truncation radius (px) = inner disc edge
  const STAR_R   = 14;   // nominal stellar radius (px) — poles are ±STAR_R above/below

  // 4 funnels: 2 go to north pole (+z), 2 to south pole (-z)
  // azimuthal offsets separated by π so they are diametrically opposite in disc
  const FUNNELS = [
    { azOff: 0.0,        poleSign: +1, width: 2.2, opa: 0.65 },   // north, arm A
    { azOff: Math.PI,    poleSign: +1, width: 1.8, opa: 0.55 },   // north, arm B
    { azOff: Math.PI/2,  poleSign: -1, width: 2.2, opa: 0.65 },   // south, arm A
    { azOff: 3*Math.PI/2,poleSign: -1, width: 1.8, opa: 0.55 },   // south, arm B
  ];

  /* ─── bipolar jet ─────────────────────────────────────────────── */
  const JET_PARTICLES = Array.from({ length: 120 }, () => ({
    prog: Math.random(),
    spd:  0.0022 + Math.random() * 0.0035,
    side: Math.random() < 0.5 ? 1 : -1,
    wob:  (Math.random() - 0.5) * 14,
    fade: 0.04 + Math.random() * 0.09
  }));

  /* ─────────────────────────────────────────────────────────────────
   * drawInnerDisc()
   * Renders INNER_BANDS as continuous elliptical glowing bands.
   * For each band we draw a series of concentric ellipse strokes with
   * decreasing opacity to simulate a smooth dust continuum rather than
   * a collection of points.
   * We also draw the stroke twice — back half (sin θ < 0) dimmer,
   * front half (sin θ > 0) brighter — to preserve the 3-D occlusion.
   * ───────────────────────────────────────────────────────────────── */
  function drawInnerDisc() {
    const inc = 0.32 + tiltY * 0.42;

    INNER_BANDS.forEach(b => {
      b.angle += b.spd * 0.5;  // slow texture drift — not visually important but authentic

      const [rr, gg, bb] = b.rgba;
      const layers = 5;   // stack of ellipse strokes to build up the glow

      for (let l = 0; l < layers; l++) {
        const frac   = l / (layers - 1);          // 0 = inner edge, 1 = outer edge
        const r      = b.r + (frac - 0.5) * b.hw * 2;
        const alpha  = b.peak * (1 - Math.abs(frac - 0.5) * 1.6) * 0.55;
        if (alpha <= 0) continue;

        const aScaled = r * inc;                   // semi-minor axis (projected)
        const xOff    = tiltX * r * 0.22;

        // ── back half of ellipse (far side, dimmer) ──────────
        ctx.beginPath();
        // Draw ellipse arc from π to 2π (sin θ < 0 = back)
        for (let i = 0; i <= 60; i++) {
          const angle = Math.PI + (i / 60) * Math.PI;
          const ex    = cx + xOff + Math.cos(angle) * r;
          const ey    = cy + Math.sin(angle) * aScaled;
          i === 0 ? ctx.moveTo(ex, ey) : ctx.lineTo(ex, ey);
        }
        ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alpha * 0.45})`;
        ctx.lineWidth   = 1.4 + l * 0.3;
        ctx.stroke();

        // ── front half of ellipse (near side, full brightness) ─
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
          const angle = (i / 60) * Math.PI;
          const ex    = cx + xOff + Math.cos(angle) * r;
          const ey    = cy + Math.sin(angle) * aScaled;
          i === 0 ? ctx.moveTo(ex, ey) : ctx.lineTo(ex, ey);
        }
        ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alpha})`;
        ctx.lineWidth   = 1.4 + l * 0.3;
        ctx.stroke();
      }

      // Continuous glow fill between inner/outer edge using radial gradient trick
      const rInner = b.r - b.hw;
      const rOuter = b.r + b.hw;
      const [rr2, gg2, bb2] = b.rgba;
      // Draw filled annulus as a set of concentric thin ellipse strokes
      for (let dr = rInner; dr <= rOuter; dr += 0.8) {
        const a    = (dr - rInner) / (rOuter - rInner);      // 0→1 across band
        const alp  = b.peak * Math.sin(a * Math.PI) * 0.18;  // bell profile
        const inc2 = dr * inc;
        ctx.beginPath();
        ctx.ellipse(cx + tiltX * dr * 0.22, cy, dr, inc2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rr2},${gg2},${bb2},${alp})`;
        ctx.lineWidth   = 0.9;
        ctx.stroke();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────
   * drawFunnel(f)
   *
   * Start : inner disc rim at (angle, R_TRUNC, z=0) in disc coords.
   * End   : stellar pole projected to screen.
   *         The pole is AT the star centre ± STAR_R in the z-direction
   *         (i.e. directly above or below the star in 3-D).
   *         In projected coords with inclination `inc`:
   *           pole_x ≈ cx  (on the rotation axis — no radial offset)
   *           pole_y = cy  ∓  STAR_R   (minus because screen y increases downward)
   *         We include the current tiltX/tiltY so the pole moves with disc tilt.
   *
   * The Bézier control point mimics the dipole field-line arch:
   *   halfway in r (inward), 60% of the way up in z — gives the characteristic
   *   "swept back" curvature of magnetospheric funnel flows.
   * ───────────────────────────────────────────────────────────────── */
  function drawFunnel(f) {
    const MAG_ROT_RATE = 0.36;   // rad/s_sim — stellar rotation (slightly faster than disc)
    const discAngle    = t * MAG_ROT_RATE + f.azOff;

    // ── P_start: where funnel lifts off the disc inner rim ─────────
    const p0 = project3D(discAngle, R_TRUNC, 0);

    // ── P_end: stellar pole (directly above/below star in 3-D) ─────
    // Pole has r=0 (on rotation axis), z = ±STAR_R
    // project3D with r=0 gives exactly (cx, cy, 0) regardless of angle,
    // then the −z term moves it up/down:  y = cy − z
    // We use a small r offset (r=2) to let the angle influence depth slightly
    // so poles sort correctly with the back/front disc in painter's algorithm.
    const poleZ  = f.poleSign * STAR_R * 1.05;   // just outside stellar surface
    const p3     = { x: cx + tiltX * 2 * 0.22,
                     y: cy - poleZ + tiltY * R_TRUNC * 0.1,
                     depth: f.poleSign * 0.5 };   // poles always near depth 0

    // ── Control point: arcs inward and upward ──────────────────────
    // r at control ≈ 35% of R_TRUNC, z ≈ 65% of poleZ
    // angle sweeps toward the pole azimuth (rotation axis = angle 0 or π)
    const cpAngle = discAngle * 0.35;  // field line bends toward rotation axis
    const cpR     = R_TRUNC * 0.35;
    const cpZ     = poleZ * 0.65;
    const cp      = project3D(cpAngle, cpR, cpZ);

    // ── Sample quadratic Bézier ─────────────────────────────────────
    const STEPS = 32;
    const pts   = Array.from({ length: STEPS + 1 }, (_, j) => {
      const s  = j / STEPS;
      const s1 = 1 - s;
      return {
        x:     s1 * s1 * p0.x + 2 * s1 * s * cp.x + s * s * p3.x,
        y:     s1 * s1 * p0.y + 2 * s1 * s * cp.y + s * s * p3.y,
        depth: s1 * s1 * p0.depth + 2 * s1 * s * cp.depth + s * s * p3.depth,
        s
      };
    });

    // ── Render as tapered, colour-shifting stroke ───────────────────
    // Colour: warm amber (disc gas, ~5000 K) → blue-white (shocked gas, ~8000 K)
    // Width : widest at disc foot (infalling column), narrows to pole
    // Opacity: low at disc (tenuous), peaks near star (dense, shocked)
    const flicker = 0.5 + 0.5 * Math.sin(t * 2.2 + f.azOff * 1.7);

    for (let k = 0; k < pts.length - 1; k++) {
      const pa = pts[k], pb = pts[k + 1];
      const s  = pa.s;

      const rr  = Math.round(240 - s * 110);   // 240 → 130
      const gg  = Math.round(165 + s *  65);   // 165 → 230
      const bbc = Math.round( 70 + s * 175);   //  70 → 245
      const alp = f.opa * (0.05 + Math.pow(s, 0.6) * 0.95) * flicker;
      const lw  = f.width * (1.0 - s * 0.60);

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = `rgba(${rr},${gg},${bbc},${alp})`;
      ctx.lineWidth   = lw;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    // ── Polar hot-spot glow (impact shock at pole) ──────────────────
    const impPulse = (0.35 + 0.3 * Math.sin(t * 2.5 + f.azOff)) * f.opa;
    const ig = ctx.createRadialGradient(p3.x, p3.y, 0, p3.x, p3.y, 9);
    ig.addColorStop(0,   `rgba(200,235,255,${impPulse})`);
    ig.addColorStop(0.5, `rgba(140,200,255,${impPulse * 0.5})`);
    ig.addColorStop(1,    'rgba(80,160,255,0.00)');
    ctx.beginPath();
    ctx.arc(p3.x, p3.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = ig;
    ctx.fill();

    // ── Disc footpoint glow (where funnel lifts off the rim) ────────
    const fp = ctx.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, 6);
    fp.addColorStop(0,   `rgba(255,210,130,${0.35 * flicker})`);
    fp.addColorStop(1,    'rgba(255,180,80,0.00)');
    ctx.beginPath();
    ctx.arc(p0.x, p0.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = fp;
    ctx.fill();
  }

  /* ─── drawStar ────────────────────────────────────────────────── */
  function drawStar() {
    const pMode   = Math.sin(t * 4.8) * 0.9 + Math.sin(t * 7.3) * 0.5;
    const breathe = Math.sin(t * 1.1) * 1.8;
    const R       = STAR_R - 1 + breathe + pMode * 0.4;

    // Extended corona
    const corona = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 5.5);
    corona.addColorStop(0,   'rgba(255,210,130,0.26)');
    corona.addColorStop(0.3, 'rgba(255,160, 70,0.09)');
    corona.addColorStop(0.7, 'rgba(255,100, 30,0.03)');
    corona.addColorStop(1,   'rgba(255, 60,  0,0.00)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 5.5, 0, Math.PI * 2);
    ctx.fillStyle = corona; ctx.fill();

    // Chromosphere
    const chromo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.7);
    chromo.addColorStop(0, `rgba(255,200,100,${0.11 + Math.max(0, pMode) * 0.012})`);
    chromo.addColorStop(1,  'rgba(255,150,60,0.00)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = chromo; ctx.fill();

    // Photosphere (limb darkening)
    const photo = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, 0, cx, cy, R);
    photo.addColorStop(0,    '#ffffff');
    photo.addColorStop(0.30, '#fff8ee');
    photo.addColorStop(0.65, '#ffdb90');
    photo.addColorStop(0.88, '#e8952a');
    photo.addColorStop(1,    '#b85510');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = photo; ctx.fill();

    // Polar hot-spots (accretion impact — near top and bottom of star)
    // North pole: slightly above star centre on screen (y = cy - R)
    // South pole: slightly below (y = cy + R * inc_projection)
    const inc = 0.32 + tiltY * 0.42;
    const poles = [
      { y: cy - R * 0.88, pulse: 0.5 + 0.3 * Math.sin(t * 2.2 + 0.0) },
      { y: cy + R * 0.88 * inc, pulse: 0.5 + 0.3 * Math.sin(t * 2.2 + Math.PI) },
    ];
    poles.forEach(pole => {
      const hg = ctx.createRadialGradient(cx, pole.y, 0, cx, pole.y, R * 0.65);
      hg.addColorStop(0,   `rgba(195,228,255,${pole.pulse})`);
      hg.addColorStop(0.5, `rgba(150,200,255,${pole.pulse * 0.35})`);
      hg.addColorStop(1,    'rgba(100,170,255,0.00)');
      ctx.beginPath(); ctx.arc(cx, pole.y, R * 0.65, 0, Math.PI * 2);
      ctx.fillStyle = hg; ctx.fill();
    });

    // Pulsation flash
    if (pMode > 1.1) {
      const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      flash.addColorStop(0, `rgba(255,255,240,${(pMode - 1.1) * 0.20})`);
      flash.addColorStop(1,  'rgba(255,255,240,0.00)');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = flash; ctx.fill();
    }
  }

  /* ─── main draw loop ──────────────────────────────────────────── */
  function draw() {
    t     += 0.012;
    tiltX += (targetTX - tiltX) * 0.04;
    tiltY += (targetTY - tiltY) * 0.04;

    ctx.fillStyle = '#00000d';
    ctx.fillRect(0, 0, W, H);

    /* Background stars */
    bgStars.forEach(s => {
      const tw  = 0.17 + Math.sin(t * s.sp + s.ph) * 0.11;
      const col = s.warm > 0.55
        ? `rgba(255,238,200,${tw})`
        : `rgba(190,210,255,${tw})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
    });

    /* Faint Milky Way */
    const mw = ctx.createLinearGradient(0, H * 0.2, W, H * 0.8);
    mw.addColorStop(0,   'rgba(30,40,70,0.00)');
    mw.addColorStop(0.5, 'rgba(30,40,70,0.04)');
    mw.addColorStop(1,   'rgba(30,40,70,0.00)');
    ctx.fillStyle = mw; ctx.fillRect(0, 0, W, H);

    /* Bipolar micro-jet */
    JET_PARTICLES.forEach(j => {
      j.prog += j.spd;
      if (j.prog > 1) j.prog = 0;
      const p   = j.prog;
      const jx  = cx + j.wob * (1 - p * 0.7);
      const jy  = cy + j.side * p * 175;
      const alp = (1 - p) * j.fade * (0.5 + 0.5 * Math.sin(t * 1.5));
      ctx.beginPath();
      ctx.arc(jx, jy, 0.7 + p * 1.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(130,190,255,${alp})`; ctx.fill();
    });

    /* Scattered light haze */
    haze.forEach(h => {
      h.angle += h.spd;
      const { x, y } = project3D(h.angle, h.r, 0);
      ctx.beginPath();
      ctx.arc(x, y, h.sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,175,110,${h.alpha})`; ctx.fill();
    });

    /* ── Build render list (painter's algorithm) ────────────────── */
    const renderList = [];

    // Inner disc rendered as bands — always behind star; two depth entries:
    // back half slightly behind, front half slightly in front
    renderList.push({ type: 'inner-back',  depth: -200 });  // behind everything
    renderList.push({ type: 'inner-front', depth:   -1 });  // just behind star

    // Outer disc particles
    OUTER_RINGS.forEach(ring => {
      ring.pts.forEach(p => {
        p.angle += ring.spd + p.dAngle;
        const r    = ring.r + p.dR;
        const proj = project3D(p.angle, r, 0);
        renderList.push({ type: 'dust', x: proj.x, y: proj.y,
                          depth: proj.depth, sz: p.sz, color: ring.color(p) });
      });
    });

    // Funnels — sorted by midpoint depth
    FUNNELS.forEach(f => {
      const midAngle = t * 0.36 + f.azOff + 0.3 * f.poleSign;
      const mid      = project3D(midAngle, R_TRUNC * 0.4, f.poleSign * STAR_R * 0.5);
      renderList.push({ type: 'funnel', funnel: f, depth: mid.depth });
    });

    renderList.push({ type: 'star', depth: 0 });

    renderList.sort((a, b) => a.depth - b.depth);

    /* ── Render ─────────────────────────────────────────────────── */
    // We need to know current inclination for inner-disc drawing
    renderList.forEach(item => {
      switch (item.type) {
        case 'inner-back':
          // Draw only the back half of each inner band (sin θ < 0, far side)
          drawInnerDiscHalf('back');
          break;
        case 'inner-front':
          // Draw only the front half (near side)
          drawInnerDiscHalf('front');
          break;
        case 'star':
          drawStar();
          break;
        case 'funnel':
          drawFunnel(item.funnel);
          break;
        case 'dust':
          ctx.fillStyle = item.color;
          ctx.fillRect(item.x, item.y, item.sz, item.sz);
          break;
      }
    });

    requestAnimationFrame(draw);
  }

  /* ─── drawInnerDiscHalf ───────────────────────────────────────────
   * Draws either the back (far) or front (near) half of the inner
   * continuous bands, so the star correctly occludes the back of the disc
   * and the front half of the disc occludes the star equator.
   * ───────────────────────────────────────────────────────────────── */
  function drawInnerDiscHalf(half) {
    const inc    = 0.32 + tiltY * 0.42;
    const aStart = half === 'back'  ? Math.PI : 0;
    const aEnd   = half === 'back'  ? 2 * Math.PI : Math.PI;
    const dimFac = half === 'back'  ? 0.42 : 1.0;

    INNER_BANDS.forEach(b => {
      const [rr, gg, bb] = b.rgba;

      // Continuous glow fill (ellipse annulus)
      const rInner = b.r - b.hw;
      const rOuter = b.r + b.hw;
      for (let dr = rInner; dr <= rOuter; dr += 0.9) {
        const a    = (dr - rInner) / (rOuter - rInner);
        const alp  = b.peak * Math.sin(a * Math.PI) * 0.22 * dimFac;
        const xOff = tiltX * dr * 0.22;

        ctx.beginPath();
        ctx.ellipse(cx + xOff, cy, dr, dr * inc, 0, aStart, aEnd);
        ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alp})`;
        ctx.lineWidth   = 1.1;
        ctx.stroke();
      }

      // Bright ring line (peak of band)
      const xOff = tiltX * b.r * 0.22;
      ctx.beginPath();
      ctx.ellipse(cx + xOff, cy, b.r, b.r * inc, 0, aStart, aEnd);
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${b.peak * 0.55 * dimFac})`;
      ctx.lineWidth   = 2.0;
      ctx.stroke();
    });
  }

  draw();
})();
