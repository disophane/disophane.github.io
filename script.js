/* global THREE, ScrollTrigger, gsap */

// SECTION: Basic Setup & DOM References -------------------------------

const heroCard = document.getElementById('heroCard');
const webglCanvas = document.getElementById('webglCanvas');
const yearEl = document.getElementById('year');
const scrollButtons = document.querySelectorAll('[data-scroll-to]');

const particlesToggle = document.getElementById('particlesToggle');
const particlesStatus = document.getElementById('particlesStatus');
let particlesEnabled = true;

const targetInput = document.getElementById('targetUrl');
const proxyInput = document.getElementById('proxyUrl');
const pingButton = document.getElementById('pingButton');
const pingStatusEl = document.getElementById('pingStatus');
const pingTimeEl = document.getElementById('pingTime');
const pingRequestEl = document.getElementById('pingRequest');
const pingSummaryEl = document.getElementById('pingSummary');
const pingHeadersEl = document.getElementById('pingHeaders');

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

if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

// Smooth scroll buttons
scrollButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetSelector = btn.getAttribute('data-scroll-to');
    if (!targetSelector) return;
    const target = document.querySelector(targetSelector);
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Toggle particles
if (particlesToggle) {
  particlesToggle.classList.add('meta-pill--particles-on');

  particlesToggle.addEventListener('click', () => {
    particlesEnabled = !particlesEnabled;
    particlesStatus.textContent = particlesEnabled ? 'On' : 'Off';
  });
}

// HERO CARD -----------------------------------------------------------

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

// THREE.JS PARTICLES --------------------------------------------------

(function initThreeShell() {
  if (typeof THREE === 'undefined' || !webglCanvas) return;

  const CONFIG = {
    PARTICLE_COUNT: 4000,
    FIELD_WIDTH: 52,
    FIELD_HEIGHT: 32,
    FIELD_DEPTH: 65,
    SCROLL_DOLLY: 30,
    MOUSE_LERP: 0.06,
    BASE_FOV: 55
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.BASE_FOV,
    window.innerWidth / window.innerHeight,
    0.1,
    200
  );

  camera.position.set(0, 0, 32);

  const renderer = new THREE.WebGLRenderer({
    canvas: webglCanvas,
    antialias: true
  });

  renderer.setSize(window.innerWidth, window.innerHeight);

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const velocities = new Float32Array(CONFIG.PARTICLE_COUNT * 3);
  const colors = new Float32Array(CONFIG.PARTICLE_COUNT * 3);

  const colorNear = new THREE.Color(0xff2136);
  const colorFar = new THREE.Color(0x050508);

  for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
    const i3 = i * 3;

    positions[i3] = (Math.random() - 0.5) * CONFIG.FIELD_WIDTH;
    positions[i3 + 1] = (Math.random() - 0.5) * CONFIG.FIELD_HEIGHT;
    positions[i3 + 2] = (Math.random() - 0.5) * CONFIG.FIELD_DEPTH;

    velocities[i3] = (Math.random() - 0.5) * 4;
    velocities[i3 + 1] = (Math.random() - 0.5) * 4;
    velocities[i3 + 2] = (Math.random() - 0.5) * 4;

    const t = Math.random();
    const c = colorNear.clone().lerp(colorFar, t);

    colors[i3] = c.r;
    colors[i3 + 1] = c.g;
    colors[i3 + 2] = c.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // ---------------- FIXED CIRCULAR PARTICLE TEXTURE ----------------

  const texCanvas = document.createElement('canvas');
  texCanvas.width = 64;
  texCanvas.height = 64;

  const ctx = texCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);

  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const texture = new THREE.CanvasTexture(texCanvas);

  const material = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };

  let scrollFactor = 0;
  let scrollTarget = 0;
  const clock = new THREE.Clock();

  window.addEventListener('scroll', () => {
    const maxScroll = window.innerHeight * 1.5;
    scrollTarget = THREE.MathUtils.clamp(window.scrollY / maxScroll, 0, 1);
  });

  window.addEventListener('mousemove', (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  function animate() {
    requestAnimationFrame(animate);

    if (!particlesEnabled) {
      particles.visible = false;
      return;
    }

    particles.visible = true;

    const delta = clock.getDelta();

    mouse.x += (mouse.tx - mouse.x) * CONFIG.MOUSE_LERP;
    mouse.y += (mouse.ty - mouse.y) * CONFIG.MOUSE_LERP;

    const scrollSpeed = 8;
    scrollFactor += (scrollTarget - scrollFactor) * (1 - Math.exp(-scrollSpeed * delta));

    const targetZ = 32 - scrollFactor * CONFIG.SCROLL_DOLLY;

    camera.position.x = mouse.x * 5;
    camera.position.y = mouse.y * 5;

    camera.position.z += (targetZ - camera.position.z) * (1 - Math.exp(-10 * delta));

    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  animate();
})();
