/* global THREE, ScrollTrigger, gsap */

// SECTION: Basic Setup & DOM References -------------------------------

// Cache DOM elements we use multiple times
const heroCard = document.getElementById('heroCard');
const webglCanvas = document.getElementById('webglCanvas');
const yearEl = document.getElementById('year');
const scrollButtons = document.querySelectorAll('[data-scroll-to]');

// Particles toggle
const particlesToggle = document.getElementById('particlesToggle');
const particlesStatus = document.getElementById('particlesStatus');
let particlesEnabled = true;

// Ping / proxy elements
const targetInput = document.getElementById('targetUrl');
const proxyInput = document.getElementById('proxyUrl');
const pingButton = document.getElementById('pingButton');
const pingStatusEl = document.getElementById('pingStatus');
const pingTimeEl = document.getElementById('pingTime');
const pingRequestEl = document.getElementById('pingRequest');
const pingSummaryEl = document.getElementById('pingSummary');
const pingHeadersEl = document.getElementById('pingHeaders');

// New inspect controls
const ttfbButton = document.getElementById('ttfbButton');
const dnsButton = document.getElementById('dnsButton');
const weightButton = document.getElementById('weightButton');
const securityButton = document.getElementById('securityButton');
const previewButton = document.getElementById('previewButton');
const sslExpiryEl = document.getElementById('sslExpiry');
const securityHeadersEl = document.getElementById('securityHeaders');
const geoIpEl = document.getElementById('geoIp');
const dnsRecordsEl = document.getElementById('dnsRecords');
const previewResultEl = document.getElementById('previewResult');

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

// Particles toggle functionality
if (particlesToggle) {
  particlesToggle.classList.add('meta-pill--particles-on');

  particlesToggle.addEventListener('click', () => {
    particlesEnabled = !particlesEnabled;
    particlesStatus.textContent = particlesEnabled ? 'On' : 'Off';

    if (particlesEnabled) {
      particlesToggle.classList.remove('meta-pill--particles-off');
      particlesToggle.classList.add('meta-pill--particles-on');
    } else {
      particlesToggle.classList.remove('meta-pill--particles-on');
      particlesToggle.classList.add('meta-pill--particles-off');
    }
  });
}

// SECTION: 3D Card Hover (Hero) ---------------------------------------

if (heroCard) {
  const bounds = () => heroCard.getBoundingClientRect();

  heroCard.addEventListener('mousemove', (event) => {
    const rect = bounds();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const xPercent = (x / rect.width - 0.5) * 2;
    const yPercent = (y / rect.height - 0.5) * 2;

    const rotateX = yPercent * -10;
    const rotateY = xPercent * 10;

    heroCard.style.transform =
      `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translate3d(0, -4px, 24px)`;
  });

  heroCard.addEventListener('mouseleave', () => {
    heroCard.style.transform = 'rotateX(0deg) rotateY(0deg) translateZ(0)';
  });
}

// SECTION: Three.js 3D Particle Shell (full-screen) --------------------

(function initThreeShell() {
  if (typeof THREE === 'undefined' || !webglCanvas) return;

  const CONFIG = {
    PARTICLE_COUNT: 4000,
    FIELD_WIDTH: 52,
    FIELD_HEIGHT: 32,
    FIELD_DEPTH: 65,
    PARTICLE_SIZE_NEAR: 0.35,
    PARTICLE_SIZE_FAR: 0.12,
    SCROLL_DOLLY: 30,
    MOUSE_ROTATE_STRENGTH: 0.8,
    MOUSE_LERP: 0.06,
    BASE_FOV: 55,
    BG_COLOR: 0xff000000,
    COLOR_NEAR: new THREE.Color(0xff2136),
    COLOR_FAR: new THREE.Color(0x050508),
  };

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.BG_COLOR, 10, 90);
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

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const velocities = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const colors = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const edgeBias = new Float32Array(CONFIG.PARTICLE_COUNT);

  const colorNear = CONFIG.COLOR_NEAR;
  const colorFar = CONFIG.COLOR_FAR;

  for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
    const i3 = i * 3;

    positions[i3] = (Math.random() * 2 - 1) * (CONFIG.FIELD_WIDTH / 2);
    positions[i3 + 1] = (Math.random() * 2 - 1) * (CONFIG.FIELD_HEIGHT / 2);
    positions[i3 + 2] = (Math.random() * 2 - 1) * (CONFIG.FIELD_DEPTH / 2);

    velocities[i3] = (Math.random() - 0.5) * 4;
    velocities[i3 + 1] = (Math.random() - 0.5) * 4;
    velocities[i3 + 2] = (Math.random() - 0.5) * 4;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    size: CONFIG.PARTICLE_SIZE_NEAR,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  
  // 🔥 FIX START: smooth scroll system
  let scrollFactor = 0;
  let scrollTarget = 0;
  // 🔥 FIX END

  window.addEventListener('mousemove', (event) => {
    mouse.tx = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = -(event.clientY / window.innerHeight) * 2 + 1;
  });

  // 🔥 FIXED SCROLL INPUT (no direct camera control)
  window.addEventListener('scroll', () => {
    const maxScroll = window.innerHeight * 1.5;
    scrollTarget = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
  });

  function animate(now) {
    requestAnimationFrame(animate);

    if (!particlesEnabled) {
      particles.visible = false;
      return;
    }

    particles.visible = true;

    mouse.x += (mouse.tx - mouse.x) * CONFIG.MOUSE_LERP;
    mouse.y += (mouse.ty - mouse.y) * CONFIG.MOUSE_LERP;

    // 🔥 FIX: SMOOTH SCROLL INTERPOLATION
    scrollFactor += (scrollTarget - scrollFactor) * 0.08;

    const baseZ = 32 - scrollFactor * CONFIG.SCROLL_DOLLY;

    camera.position.x = mouse.x * 5;
    camera.position.y = mouse.y * 5;
    camera.position.z = baseZ;

    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  animate();
})();

// SECTION: GSAP Scroll Animations -------------------------------------

if (window.gsap && window.ScrollTrigger) {
  const gsapInstance = window.gsap;
  const ScrollTriggerInstance = window.ScrollTrigger;
  gsapInstance.registerPlugin(ScrollTriggerInstance);

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
