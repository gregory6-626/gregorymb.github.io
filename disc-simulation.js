/* disc-simulation.js — improved
 * Scientifically motivated protoplanetary disc animation
 * Features:
 *   - 11 dust rings with Keplerian shear (ω ∝ r^-1.5)
 *   - Magnetospheric cavity, dust sublimation rim, gap zones (B5/B7 analogs)
 *   - Outer diffuse halo / envelope remnant
 *   - T Tauri star: limb darkening, p-mode pulsation, hot-spot
 *   - Magnetospheric accretion funnels with curved field-line paths
 *   - Dust colour gradient: warm silicate → cool outer dust
 *   - Bipolar micro-jet
 */
(function () {
  const canvas = document.getElementById('disc-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;

  let W, H, cx, cy;
  let targetTX = 0, targetTY = 0, tiltX = 0, tiltY = 0;
  let t = 0;

  /* ── resize ─────────────────────────────────────────── */
  function resize() {
    W = canvas.width  = parent.clientWidth  || window.innerWidth;
    H = canvas.height = parent.clientHeight || window.innerHeight;
    cx = W / 2; cy = H / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', e => {
    targetTX = (e.clientX / window.innerWidth  - 0.5) * 0.15;
    targetTY = (e.clientY / window.innerHeight - 0.5) * 0.10;
  });

  /* ── background stars ────────────────────────────────── */
  const bgStars = Array.from({ length: 280 }, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.2 + 0.15,
    ph: Math.random() * Math.PI * 2,
    sp: 0.3 + Math.random() * 0.5,
    warm: Math.random()          // 0 = blue, 1 = warm yellow
  }));

  /* ── disc ring definitions ───────────────────────────────────────────────────
   * Keplerian angular velocity: ω = ω0 * (r0/r)^1.5
   * r0 = 100 px reference radius, ω0 = 0.0014 rad/frame
   * Ring anatomy (roughly scaled to HL Tau / AS 205):
   *   r=38   magnetospheric cavity edge / dust sublimation front (inner rim)
   *   r=55   bright inner rim — hottest, most luminous part of disc
   *   r=75   first bright ring B1
   *   r=100  dark gap D2 (depleted — possible planet)
   *   r=120  ring B2
   *   r=145  dark gap D4
   *   r=168  ring B4
   *   r=195  broad dark gap D5
   *   r=222  ring B5
   *   r=258  ring B6 / outer disc
   *   r=298  diffuse outer disc / envelope remnant
   * ─────────────────────────────────────────────────────────────────────────── */
  const R0 = 100, W0 = 0.00140;
  function keplerSpd(r) { return W0 * Math.pow(R0 / r, 1.5); }

  const RINGS = [
    // Inner rim — hot silicate, tight, bright
    { r:  38, spread:  4, n: 180, gap: 0.00, label: 'inner-rim',
      color: p => `rgba(255,215,140,${0.80 * p.br})` },
    // B1 — first bright ring
    { r:  58, spread:  5, n: 260, gap: 0.00, label: 'B1',
      color: p => `rgba(250,200,120,${0.70 * p.br})` },
    // B2
    { r:  78, spread:  6, n: 320, gap: 0.00, label: 'B2',
      color: p => `rgba(240,185,105,${0.65 * p.br})` },
    // D2 gap — depleted, sparse
    { r: 100, spread:  6, n:  80, gap: 0.00, label: 'D2',
      color: p => `rgba(200,155, 80,${0.15 * p.br})` },
    // B3
    { r: 120, spread:  7, n: 360, gap: 0.00, label: 'B3',
      color: p => `rgba(225,172, 95,${0.58 * p.br})` },
    // D4 gap
    { r: 145, spread:  6, n:  90, gap: 0.00, label: 'D4',
      color: p => `rgba(185,145, 80,${0.14 * p.br})` },
    // B4
    { r: 168, spread:  8, n: 400, gap: 0.00, label: 'B4',
      color: p => `rgba(210,160, 88,${0.52 * p.br})` },
    // D5 broad gap
    { r: 197, spread:  7, n:  70, gap: 0.00, label: 'D5',
      color: p => `rgba(170,135, 75,${0.12 * p.br})` },
    // B5
    { r: 222, spread: 10, n: 440, gap: 0.00, label: 'B5',
      color: p => `rgba(185,148, 85,${0.42 * p.br})` },
    // B6 — cool outer disc, slightly blue-shifted colour
    { r: 262, spread: 12, n: 460, gap: 0.00, label: 'B6',
      color: p => `rgba(165,138, 90,${0.32 * p.br})` },
    // Diffuse outer disc / remnant envelope
    { r: 308, spread: 22, n: 500, gap: 0.00, label: 'envelope',
      color: p => `rgba(140,120, 85,${0.15 * p.br})` },
  ];

  RINGS.forEach(ring => {
    ring.spd = keplerSpd(ring.r);
    ring.pts = Array.from({ length: ring.n }, () => ({
      angle:  Math.random() * Math.PI * 2,
      dR:     (Math.random() - 0.5) * ring.spread,
      sz:     Math.random() * 1.4 + 0.3,
      br:     0.35 + Math.random() * 0.65,
      dAngle: (Math.random() - 0.5) * 0.000012  // slight velocity dispersion
    }));
  });

  /* ── scattered-light haze (disc surface scattering) ─── */
  const haze = Array.from({ length: 500 }, () => {
    const r = 40 + Math.random() * 280;
    return { angle: Math.random() * Math.PI * 2, r, sz: Math.random() * 0.8 + 0.1,
             alpha: Math.random() * 0.06, spd: keplerSpd(r) * 0.4 };
  });

  /* ── magnetospheric accretion funnels ────────────────────────────────────────
   * In T Tauri stars the stellar magnetic field (dipole tilted ~10–30°) truncates
   * the disc at the magnetospheric radius (~3–5 R★) and channels material along
   * field lines to two high-latitude hot-spots.
   * We model 4 funnels, 2 on each side, offset ±hotSpotLat in z, tracing a
   * curved Bézier-like path from disc truncation radius inward.
   * ─────────────────────────────────────────────────────────────────────────── */
  const MAG_TRUNCATION_R = 38;      // disc inner edge ≈ magnetospheric radius
  const HOTSPOT_LAT_Z    = 28;      // vertical offset of hot-spot in projected coords

  const FUNNELS = Array.from({ length: 4 }, (_, i) => ({
    phaseOffset: i * (Math.PI / 2) + 0.3,
    zDir:        i % 2 === 0 ? 1 : -1,
    width:       2.0 + Math.random() * 0.8,
    opacity:     0.55 + Math.random() * 0.25
  }));

  /* ── bipolar micro-jet particles ─────────────────────── */
  const JET_PARTICLES = Array.from({ length: 120 }, () => ({
    prog:  Math.random(),
    spd:   0.0022 + Math.random() * 0.0035,
    side:  Math.random() < 0.5 ? 1 : -1,
    wob:   (Math.random() - 0.5) * 16,
    fade:  0.04 + Math.random() * 0.09
  }));

  /* ── project disc coords → screen ───────────────────── */
  function project3D(angle, r, z) {
    const inc = 0.34 + tiltY * 0.42;  // inclination + interactive tilt
    return {
      x:     cx + Math.cos(angle) * r + tiltX * r * 0.22,
      y:     cy + Math.sin(angle) * r * inc - z,
      depth: Math.sin(angle) * r + z * 0.6
    };
  }

  /* ── draw star (T Tauri — p-mode pulsation + hot-spot) ─ */
  function drawStar() {
    // Multi-frequency pulsation: p-mode (fast, small) + breathing (slow)
    const pMode    = Math.sin(t * 4.8) * 0.9 + Math.sin(t * 7.3) * 0.5;
    const breathe  = Math.sin(t * 1.1) * 1.8;
    const R        = 13 + breathe + pMode * 0.4;  // stellar radius in px

    // Extended corona / stellar wind halo
    const corona = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 5.5);
    corona.addColorStop(0,   'rgba(255,210,130,0.28)');
    corona.addColorStop(0.3, 'rgba(255,160, 70,0.10)');
    corona.addColorStop(0.7, 'rgba(255,100, 30,0.03)');
    corona.addColorStop(1,   'rgba(255, 60,  0,0.00)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 5.5, 0, Math.PI * 2);
    ctx.fillStyle = corona; ctx.fill();

    // Chromosphere
    const chromo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6);
    chromo.addColorStop(0,   `rgba(255,200,100,${0.12 + pMode * 0.015})`);
    chromo.addColorStop(1,   'rgba(255,150, 60,0.00)');
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = chromo; ctx.fill();

    // Photosphere with limb darkening
    const photo = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, 0, cx, cy, R);
    photo.addColorStop(0,    '#ffffff');
    photo.addColorStop(0.30, '#fff8ee');
    photo.addColorStop(0.65, '#ffdb90');
    photo.addColorStop(0.88, '#e8952a');   // limb darkening
    photo.addColorStop(1,    '#b85510');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = photo; ctx.fill();

    // Hot-spot: accretion impact on stellar surface — rotates with star
    const hsAngle = t * 0.35;
    const hsX = cx + Math.cos(hsAngle) * R * 0.55;
    const hsY = cy + Math.sin(hsAngle) * R * 0.30;   // projected latitude
    const hsPulse = 0.55 + Math.sin(t * 2.1) * 0.20; // brightens as funnel feeds
    const hs = ctx.createRadialGradient(hsX, hsY, 0, hsX, hsY, R * 0.55);
    hs.addColorStop(0,   `rgba(200,230,255,${hsPulse})`);
    hs.addColorStop(0.5, `rgba(160,200,255,${hsPulse * 0.4})`);
    hs.addColorStop(1,   'rgba(100,170,255,0.00)');
    ctx.beginPath(); ctx.arc(hsX, hsY, R * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = hs; ctx.fill();

    // Pulsation brightness flash on stellar disc
    if (pMode > 1.2) {
      const flash = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      flash.addColorStop(0,   `rgba(255,255,240,${(pMode - 1.2) * 0.18})`);
      flash.addColorStop(1,    'rgba(255,255,240,0.00)');
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = flash; ctx.fill();
    }
  }

  /* ── draw one accretion funnel ───────────────────────── */
  function drawFunnel(funnel) {
    const steps  = 28;
    // Funnel base angle co-rotates with magnetosphere
    const baseAngle = t * 0.38 + funnel.phaseOffset;

    // Control points for Bézier-like path:
    // P0 = disc truncation rim, P3 = hot-spot near stellar surface
    const p0 = project3D(baseAngle, MAG_TRUNCATION_R, 0);
    const p3 = project3D(baseAngle + 0.45 * funnel.zDir, 6, funnel.zDir * HOTSPOT_LAT_Z);

    // Build curved path sampling a quadratic Bézier
    // Control point: pulled inward & upward (dipole field line shape)
    const cpR = MAG_TRUNCATION_R * 0.45;
    const cpZ = funnel.zDir * HOTSPOT_LAT_Z * 0.55;
    const cp  = project3D(baseAngle + 0.25 * funnel.zDir, cpR, cpZ);

    const pts = Array.from({ length: steps + 1 }, (_, j) => {
      const s  = j / steps;
      const s2 = s * s, s1 = 1 - s;
      // Quadratic Bézier
      return {
        x:     s1 * s1 * p0.x + 2 * s1 * s * cp.x + s2 * p3.x,
        y:     s1 * s1 * p0.y + 2 * s1 * s * cp.y + s2 * p3.y,
        depth: s1 * s1 * p0.depth + 2 * s1 * s * cp.depth + s2 * p3.depth,
        s                                        // progress 0→1
      };
    });

    // Draw as tapered stroke — wider at disc, narrow at star
    for (let k = 0; k < pts.length - 1; k++) {
      const pa = pts[k], pb = pts[k + 1];
      const s  = pa.s;
      // Opacity: dim at disc edge, bright as material approaches star
      const alp = funnel.opacity * (0.08 + s * 0.92) * (0.5 + 0.5 * Math.sin(t * 1.8 + funnel.phaseOffset));
      const lw  = funnel.width * (1 - s * 0.55);   // tapers toward star

      // Colour: orange-amber at disc → hot blue-white near star (shock heating)
      const rr = Math.round(235 - s * 90);
      const gg = Math.round(170 + s * 50);
      const bb = Math.round( 80 + s * 160);

      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${alp})`;
      ctx.lineWidth   = lw;
      ctx.lineCap     = 'round';
      ctx.stroke();
    }

    // Impact glow at stellar surface end
    const impactPulse = 0.4 + 0.3 * Math.sin(t * 2.1 + funnel.phaseOffset);
    const ig = ctx.createRadialGradient(p3.x, p3.y, 0, p3.x, p3.y, 10);
    ig.addColorStop(0,   `rgba(180,220,255,${impactPulse * funnel.opacity})`);
    ig.addColorStop(1,    'rgba(100,180,255,0.00)');
    ctx.beginPath(); ctx.arc(p3.x, p3.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = ig; ctx.fill();
  }

  /* ── main draw loop ──────────────────────────────────── */
  function draw() {
    t      += 0.012;
    tiltX  += (targetTX - tiltX) * 0.04;
    tiltY  += (targetTY - tiltY) * 0.04;

    ctx.fillStyle = '#00000d';
    ctx.fillRect(0, 0, W, H);

    /* Background stars — two colour populations */
    bgStars.forEach(s => {
      const tw  = 0.18 + Math.sin(t * s.sp + s.ph) * 0.12;
      const col = s.warm > 0.55
        ? `rgba(255,238,200,${tw})`
        : `rgba(190,210,255,${tw})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
    });

    /* Faint Milky Way scatter */
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
      const jy  = cy + j.side * p * 170;
      const alp = (1 - p) * j.fade * (0.5 + 0.5 * Math.sin(t * 1.5));
      const sz  = 0.7 + p * 1.5;
      ctx.beginPath(); ctx.arc(jx, jy, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(130,190,255,${alp})`; ctx.fill();
    });

    /* Scattered-light haze (disc surface) */
    haze.forEach(h => {
      h.angle += h.spd;
      const { x, y } = project3D(h.angle, h.r, 0);
      ctx.beginPath(); ctx.arc(x, y, h.sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(210,175,110,${h.alpha})`; ctx.fill();
    });

    /* ── render list: back disc + star + funnels + front disc ── */
    let renderList = [];

    RINGS.forEach(ring => {
      ring.pts.forEach(p => {
        p.angle += ring.spd + p.dAngle;
        const r    = ring.r + p.dR;
        const proj = project3D(p.angle, r, 0);
        renderList.push({ type: 'dust', x: proj.x, y: proj.y, depth: proj.depth, sz: p.sz, color: ring.color(p) });
      });
    });

    // Funnels — sort by their midpoint depth
    FUNNELS.forEach(f => {
      const midA = t * 0.38 + f.phaseOffset + 0.225 * f.zDir;
      const mid  = project3D(midA, MAG_TRUNCATION_R * 0.5, f.zDir * HOTSPOT_LAT_Z * 0.5);
      renderList.push({ type: 'funnel', funnel: f, depth: mid.depth });
    });

    renderList.push({ type: 'star', depth: 0 });   // star at depth 0

    renderList.sort((a, b) => a.depth - b.depth);

    renderList.forEach(item => {
      if      (item.type === 'star')   { drawStar(); }
      else if (item.type === 'funnel') { drawFunnel(item.funnel); }
      else {
        ctx.fillStyle = item.color;
        ctx.fillRect(item.x, item.y, item.sz, item.sz);
      }
    });

    requestAnimationFrame(draw);
  }

  draw();
})();
