/* global THREE, ScrollTrigger, gsap */

// SECTION: Basic Setup & DOM References -------------------------------

// Cache DOM elements we use multiple times
const heroCard = document.getElementById('heroCard');
const webglCanvas = document.getElementById('webglCanvas');
const yearEl = document.getElementById('year');
const scrollButtons = document.querySelectorAll('[data-scroll-to]');

// Ping / proxy elements
const targetInput = document.getElementById('targetUrl');
const proxyInput = document.getElementById('proxyUrl');
const pingButton = document.getElementById('pingButton');
const pingStatusEl = document.getElementById('pingStatus');
const pingTimeEl = document.getElementById('pingTime');
const pingRequestEl = document.getElementById('pingRequest');
const pingSummaryEl = document.getElementById('pingSummary');
const pingHeadersEl = document.getElementById('pingHeaders');

// Set current year in footer
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

// Smooth scroll for CTA buttons
scrollButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetSelector = btn.getAttribute('data-scroll-to');
    if (!targetSelector) return;
    const target = document.querySelector(targetSelector);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// SECTION: 3D Card Hover (Hero) ---------------------------------------

if (heroCard) {
  const bounds = () => heroCard.getBoundingClientRect();

  heroCard.addEventListener('mousemove', (event) => {
    const rect = bounds();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const xPercent = (x / rect.width - 0.5) * 2; // -1 to 1
    const yPercent = (y / rect.height - 0.5) * 2; // -1 to 1

    const rotateX = yPercent * -10; // tilt up/down
    const rotateY = xPercent * 10; // tilt left/right

    heroCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(0, -4px, 24px)`;
  });

  heroCard.addEventListener('mouseleave', () => {
    heroCard.style.transform = 'rotateX(14deg) rotateY(-18deg) translateZ(0)';
  });
}

// SECTION: Three.js 3D Particle Shell (full-screen) --------------------

/**
 * This creates a realistic black + red 3D particle shell around the site.
 * - Uses Three.js (loaded via CDN in index.html)
 * - Full-screen canvas fixed behind all content
 * - Particles have depth (z), size and blur depend on distance
 * - Scroll: camera dolly + particles slightly shrink
 * - Mouse: camera orbits subtly, particles feel like they move around cursor
 *
 * You can tweak:
 * - PARTICLE_COUNT, FIELD_RADIUS, COLOR settings in CONFIG
 * - Motion strengths in the update loop
 */

(function initThreeShell() {
  if (typeof THREE === 'undefined' || !webglCanvas) return;

  // CONFIG --------------------------------------------------------------
  const CONFIG = {
    PARTICLE_COUNT: 2200,
    FIELD_RADIUS: 28,
    PARTICLE_SIZE_NEAR: 0.26,
    PARTICLE_SIZE_FAR: 0.08,
    SCROLL_DOLLY: 18, // how far camera moves on scroll
    MOUSE_ROTATE_STRENGTH: 0.35,
    MOUSE_LERP: 0.06,
    BASE_FOV: 55,
    BG_COLOR: 0x030308,
    COLOR_NEAR: new THREE.Color(0xff2136),
    COLOR_FAR: new THREE.Color(0x050508),
  };

  // CORE OBJECTS --------------------------------------------------------
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.BG_COLOR, 10, 60);
  scene.background = new THREE.Color(CONFIG.BG_COLOR);

  const width = webglCanvas.clientWidth || window.innerWidth;
  const height = webglCanvas.clientHeight || window.innerHeight;

  const camera = new THREE.PerspectiveCamera(
    CONFIG.BASE_FOV,
    width / height,
    0.1,
    200
  );
  camera.position.set(0, 0, 32);

  const renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  // LIGHT HINT (subtle, mostly for future meshes if you add them) ------
  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);

  // PARTICLE GEOMETRY ---------------------------------------------------
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const colors = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const edgeBias = new Float32Array(CONFIG.PARTICLE_COUNT);

  const colorNear = CONFIG.COLOR_NEAR;
  const colorFar = CONFIG.COLOR_FAR;

  for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
    // Bias radius so more particles live near the outer shell (vignette feel)
    const t = Math.random();
    const r = CONFIG.FIELD_RADIUS * (0.35 + 0.65 * Math.pow(t, 0.2));
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    const i3 = i * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;

    // Depth factor 0..1 based on distance
    const dist = Math.sqrt(x * x + y * y + z * z);
    const depthT = THREE.MathUtils.clamp(dist / CONFIG.FIELD_RADIUS, 0, 1);
    edgeBias[i] = depthT; // 0 = center, 1 = outer shell

    // Color lerp between near red and dark far, stronger red at edges
    const edgeBoost = 0.25 * depthT;
    const c = colorNear
      .clone()
      .lerp(colorFar, depthT * 0.6 + (Math.random() - 0.5) * 0.15)
      .lerp(colorNear, edgeBoost);
    colors[i3] = c.r;
    colors[i3 + 1] = c.g;
    colors[i3 + 2] = c.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('edgeBias', new THREE.BufferAttribute(edgeBias, 1));

  const material = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // MOTION STATE --------------------------------------------------------
  const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let scrollFactor = 0; // 0 at top, ~1 when scrolled down
  let mouseWorld = new THREE.Vector3();

  // EVENTS --------------------------------------------------------------
  window.addEventListener('mousemove', (event) => {
    const xNorm = (event.clientX / window.innerWidth) * 2 - 1; // -1..1
    const yNorm = (event.clientY / window.innerHeight) * 2 - 1; // -1..1
    mouse.targetX = xNorm;
    mouse.targetY = yNorm;

    // Project mouse into world space near the camera look-at plane
    const ndc = new THREE.Vector3(xNorm, -yNorm, 0.5);
    ndc.unproject(camera);
    mouseWorld.copy(ndc);
  });

  window.addEventListener('scroll', () => {
    const maxScroll = window.innerHeight * 1.5;
    scrollFactor = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
  });

  function onResize() {
    const w = webglCanvas.clientWidth || window.innerWidth;
    const h = webglCanvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  window.addEventListener('resize', onResize);

  // ANIMATION LOOP ------------------------------------------------------
  let lastTime = performance.now();

  function animate(now) {
    requestAnimationFrame(animate);

    const delta = (now - lastTime) / 1000;
    lastTime = now;

    // Lerp mouse for smooth camera motion
    mouse.x += (mouse.targetX - mouse.x) * CONFIG.MOUSE_LERP;
    mouse.y += (mouse.targetY - mouse.y) * CONFIG.MOUSE_LERP;

    // Camera base position and scroll dolly
    const baseZ = 32 - scrollFactor * CONFIG.SCROLL_DOLLY;
    const rotX = mouse.y * CONFIG.MOUSE_ROTATE_STRENGTH;
    const rotY = mouse.x * CONFIG.MOUSE_ROTATE_STRENGTH;

    camera.position.x = Math.sin(rotY) * baseZ * 0.18;
    camera.position.y = Math.sin(-rotX) * baseZ * 0.12;
    camera.position.z = baseZ;
    camera.lookAt(0, 0, 0);

    // Subtle rotation of the whole field
    particles.rotation.y += 0.04 * delta;
    particles.rotation.x += 0.01 * delta;

    // Slight breathing scale based on scroll
    const scale = 1 - scrollFactor * 0.25;
    particles.scale.setScalar(scale);

    // Mouse repulsion in a circular pattern around cursor
    const posAttr = geometry.getAttribute('position');
    const edgeAttr = geometry.getAttribute('edgeBias');
    const arr = posAttr.array;
    const edgeArr = edgeAttr.array;

    const maxInfluence = CONFIG.FIELD_RADIUS * 0.9;
    const repelStrength = 12;

    for (let i = 0; i < arr.length; i += 3) {
      const ex = arr[i];
      const ey = arr[i + 1];
      const ez = arr[i + 2];

      const dx = ex - mouseWorld.x;
      const dy = ey - mouseWorld.y;
      const dz = ez - mouseWorld.z;

      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      if (dist < maxInfluence) {
        const t = 1 - dist / maxInfluence;
        const edge = edgeArr[i / 3];

        // Direction away from mouse
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // Rotate that direction around camera-forward axis to get a circular flow
        const angle = t * 3.2;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // Use camera forward as axis approximation (0,0,-1 in camera space)
        const rx = nx * cosA - ny * sinA;
        const ry = nx * sinA + ny * cosA;
        const rz = nz;

        const push = repelStrength * t * (0.4 + 0.6 * edge);

        arr[i] += rx * push * delta;
        arr[i + 1] += ry * push * delta;
        arr[i + 2] += rz * push * delta;
      }
    }

    posAttr.needsUpdate = true;

    renderer.render(scene, camera);
  }

  animate(performance.now());
})();

// SECTION: GSAP Scroll Animations -------------------------------------

if (window.gsap && window.ScrollTrigger) {
  const gsapInstance = window.gsap;
  const ScrollTriggerInstance = window.ScrollTrigger;
  gsapInstance.registerPlugin(ScrollTriggerInstance);

  // Fade / slide in sections
  gsapInstance.utils.toArray('.section').forEach((section) => {
    gsapInstance.from(section, {
      opacity: 0,
      y: 40,
      duration: 0.7,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: section,
        start: 'top 80%',
      },
    });
  });

  // Slight parallax for hero card
  if (heroCard) {
    gsapInstance.to('#heroCard', {
      y: -18,
      scrollTrigger: {
        trigger: '#hero',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });
  }
}

// SECTION: Proxy Ping / Fetch Playground ------------------------------

/**
 * Proxy / Ping implementation with built-in proxies and auto-failover.
 *
 * IMPORTANT: In this sandbox we cannot host real proxies, so these URLs
 * are examples. Replace them with your own if you deploy for real.
 *
 * Behavior:
 * - We keep an ordered list of proxy base URLs.
 * - For each ping, we try them in order until one works or all fail.
 * - The active proxy URL is shown in the read-only input.
 */

// Built-in proxy endpoints (examples). Replace with your own when you deploy.
const BUILT_IN_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.codetabs.com/v1/proxy/?quest=',
  'https://yacdn.org/proxy/',
];

async function performPing() {
  if (!targetInput || !proxyInput) return;

  const targetUrl = targetInput.value.trim();
  if (!targetUrl) return;

  // Update UI: running state
  pingStatusEl.textContent = 'Running…';
  pingTimeEl.textContent = '– ms';
  pingRequestEl.textContent = JSON.stringify(
    {
      target: targetUrl,
      proxiesTried: BUILT_IN_PROXIES,
      method: 'GET',
    },
    null,
    2
  );
  pingSummaryEl.textContent = '{}';
  pingHeadersEl.textContent = '{}';

  const startedOverall = performance.now();
  let lastError = null;

  for (let i = 0; i < BUILT_IN_PROXIES.length; i++) {
    const proxyBase = BUILT_IN_PROXIES[i];
    const url = proxyBase + encodeURIComponent(targetUrl);
    const started = performance.now();

    try {
      const response = await fetch(url, { method: 'GET' });
      const elapsed = Math.round(performance.now() - started);

      // Update which proxy is active in the read-only input
      proxyInput.value = proxyBase;

      // Try to parse JSON; if it fails, show text snippet instead
      let bodyText = '';
      let parsedJson = null;
      try {
        parsedJson = await response.clone().json();
      } catch (e) {
        try {
          bodyText = await response.text();
        } catch (e2) {
          bodyText = '[unable to read body]';
        }
      }

      pingStatusEl.textContent = `${response.status} ${response.statusText}`;
      pingTimeEl.textContent = `${elapsed} ms`;

      const summary = {
        ok: response.ok,
        redirected: response.redirected,
        type: response.type,
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        proxyUsed: proxyBase,
        totalElapsedMs: Math.round(performance.now() - startedOverall),
      };

      pingSummaryEl.textContent = JSON.stringify(summary, null, 2);

      // Collect headers into a plain object for display
      const headersObj = {};
      response.headers.forEach((value, key) => {
        headersObj[key] = value;
      });

      if (parsedJson && typeof parsedJson === 'object') {
        headersObj['__body_preview'] = JSON.stringify(parsedJson).slice(0, 400);
      } else if (bodyText) {
        headersObj['__body_preview'] = bodyText.slice(0, 400);
      }

      pingHeadersEl.textContent = JSON.stringify(headersObj, null, 2);
      return; // success, stop trying proxies
    } catch (error) {
      lastError = error;
      // Try next proxy in the list
      continue;
    }
  }

  // If we reach here, all proxies failed
  const elapsedOverall = Math.round(performance.now() - startedOverall);
  pingStatusEl.textContent = 'All proxies failed';
  pingTimeEl.textContent = `${elapsedOverall} ms`;

  pingSummaryEl.textContent = JSON.stringify(
    {
      message: lastError ? lastError.message : 'Unknown error',
      hint:
        'All built-in proxies failed. In production, replace BUILT_IN_PROXIES with your own reliable endpoints.',
      proxiesTried: BUILT_IN_PROXIES,
    },
    null,
    2
  );

  pingHeadersEl.textContent = '{}';
}

if (pingButton) {
  pingButton.addEventListener('click', () => {
    performPing();
  });
}

