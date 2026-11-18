(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wordmark = document.getElementById('wordmark');

  if (wordmark) {
    'FLOWLOCK'.split('').forEach((letter, index) => {
      const character = document.createElement('span');
      character.textContent = letter;
      character.style.setProperty('--i', index);
      character.setAttribute('aria-hidden', 'true');
      wordmark.appendChild(character);
    });
  }

  const features = [...document.querySelectorAll('.feature')];
  features.forEach((feature) => feature.classList.add('fx-reveal'));

  if ('IntersectionObserver' in window && !reduceMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.2 });
    features.forEach((feature) => observer.observe(feature));
  } else {
    features.forEach((feature) => feature.classList.add('in'));
  }

  document.querySelectorAll('[data-count]').forEach((element) => {
    if (reduceMotion) return;
    const end = Number.parseFloat(element.dataset.count);
    const decimals = Number.parseInt(element.dataset.dec || '0', 10);
    const suffix = element.dataset.suffix || '';
    let startTime = null;

    function countFrame(time) {
      if (startTime === null) startTime = time;
      const progress = Math.min((time - startTime) / 1400, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = `${(end * eased).toFixed(decimals)}${suffix}`;
      if (progress < 1) requestAnimationFrame(countFrame);
    }

    element.textContent = `${(0).toFixed(decimals)}${suffix}`;
    window.setTimeout(() => requestAnimationFrame(countFrame), 300);
  });

  const panel = document.querySelector('.panel');
  if (panel && !reduceMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    panel.addEventListener('pointermove', (event) => {
      const bounds = panel.getBoundingClientRect();
      const x = (event.clientX - bounds.left) / bounds.width - 0.5;
      const y = (event.clientY - bounds.top) / bounds.height - 0.5;
      panel.style.transform = `perspective(900px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
    });
    panel.addEventListener('pointerleave', () => { panel.style.transform = ''; });
  }

  if (reduceMotion) return;
  const canvas = document.getElementById('flowCanvas');
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return;

  let width = 0;
  let height = 0;
  let scale = 1;
  let particles = [];

  function resizeCanvas() {
    scale = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    particles = Array.from({ length: Math.min(72, Math.round(width / 20)) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.5 + 0.4,
      speed: Math.random() * 0.25 + 0.08,
      phase: Math.random() * Math.PI * 2
    }));
  }

  function drawFrame(time) {
    const t = time * 0.00035;
    context.clearRect(0, 0, width, height);

    for (let wave = 0; wave < 3; wave += 1) {
      context.beginPath();
      for (let x = 0; x <= width; x += 16) {
        const y = height * (0.66 + wave * 0.055)
          + Math.sin(x / 105 + t * (1 + wave * 0.12) + wave) * 22
          + Math.sin(x / 54 - t * 1.4) * 7;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = `rgba(168, 85, 247, ${0.14 - wave * 0.025})`;
      context.lineWidth = 1;
      context.stroke();
    }

    particles.forEach((particle) => {
      particle.y -= particle.speed;
      particle.x += Math.sin(particle.phase + t) * 0.16;
      if (particle.y < -8) {
        particle.y = height + 8;
        particle.x = Math.random() * width;
      }
      context.beginPath();
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = 'rgba(196, 181, 253, 0.48)';
      context.fill();
    });

    requestAnimationFrame(drawFrame);
  }

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas, { passive: true });
  requestAnimationFrame(drawFrame);
})();