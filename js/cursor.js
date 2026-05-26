/* cursor.js */
(function() {
  const dot  = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  if (!dot || !ring) return; // safety check if elements are missing
  
  let rx = 0, ry = 0, mx = 0, my = 0;

  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

  function loop() {
    rx += (mx - rx) * 0.14; ry += (my - ry) * 0.14;
    dot.style.left  = mx + 'px'; dot.style.top   = my + 'px';
    ring.style.left = rx + 'px'; ring.style.top  = ry + 'px';
    requestAnimationFrame(loop);
  }
  loop();

  // Attach expansion states to all active UI triggers
  document.querySelectorAll('a, button, .portal-card, .portrait-frame').forEach(el => {
    el.addEventListener('mouseenter', () => {
      dot.style.width = '14px'; dot.style.height = '14px';
      ring.style.width = '52px'; ring.style.height = '52px';
    });
    el.addEventListener('mouseleave', () => {
      dot.style.width = '10px'; dot.style.height = '10px';
      ring.style.width = '36px'; ring.style.height = '36px';
    });
  });
})();