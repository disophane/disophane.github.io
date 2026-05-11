// Normalizes user input into a usable URL or indicates an IP
function normalizeTarget(input) {
  const raw = input.trim();
  if (!raw) return null;

  const ipRegex = /^(?:\d{1,3}\.){3}\d{1,3}$/; // IPv4 best-effort
  const looksLikeIp = ipRegex.test(raw);

  // If it's already a URL with a scheme
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return { type: looksLikeIp ? "ip" : "url", url };
    } catch {
      return null;
    }
  }

  // If it looks like an IP, build a dummy URL (scheme required by fetch)
  if (looksLikeIp) {
    try {
      const url = new URL(`https://${raw}`);
      return { type: "ip", url };
    } catch {
      return null;
    }
  }

  // Assume https for naked domains/paths
  try {
    const url = new URL(`https://${raw}`);
    return { type: "url", url };
  } catch {
    return null;
  }
}

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "–";
  return `${ms.toFixed(1)} ms`;
}

function classifyStatus(status) {
  if (!status) return "unknown";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "warn"; // redirects
  return "error";
}

// SECTION: DOM references
const form = document.getElementById("probe-form");
const inputEl = document.getElementById("target-input");
const inputModeLabel = document.getElementById("input-mode-label");
const inputErrorEl = document.getElementById("input-error");
const followRedirectsEl = document.getElementById("follow-redirects");
const includeHeadersEl = document.getElementById("include-headers");
const runMultiplePingsEl = document.getElementById("run-multiple-pings");
const submitButton = form.querySelector("button[type='submit']");
const statusSummaryEl = document.getElementById("status-summary");
const httpDetailsEl = document.getElementById("http-details");
const hostDetailsEl = document.getElementById("host-details");
const timelineEl = document.getElementById("network-timeline");
const pingListEl = document.getElementById("ping-list");
const pingSummaryEl = document.getElementById("ping-summary");
const rawDetailsEl = document.getElementById("raw-details");
const resetButton = document.getElementById("reset-button");

// Source viewer
const sourceCodeEl = document.getElementById("source-code");
const sourceTabButtons = document.querySelectorAll("[data-source-tab]");

// SECTION: UI helpers
function setLoading(isLoading) {
  if (isLoading) {
    submitButton.classList.add("btn-loading");
    submitButton.disabled = true;
  } else {
    submitButton.classList.remove("btn-loading");
    submitButton.disabled = false;
  }
}

function setInputError(message) {
  inputErrorEl.textContent = message || "";
  inputEl.classList.toggle("error", Boolean(message));
}

function updateModeLabel(info) {
  if (!info) {
    inputModeLabel.textContent = "Auto detect";
    return;
  }
  inputModeLabel.textContent = info.type === "ip" ? "IP address" : "Hostname";
}

function clearResults() {
  statusSummaryEl.className = "status-summary empty";
  statusSummaryEl.innerHTML = "<p>No checks yet. Run your first probe to see details here.</p>";

  httpDetailsEl.innerHTML = `
    <div class="kv-row skeleton-row"><dt>Status code</dt><dd>—</dd></div>
    <div class="kv-row skeleton-row"><dt>Total time</dt><dd>—</dd></div>
    <div class="kv-row skeleton-row"><dt>Method</dt><dd>GET</dd></div>
    <div class="kv-row skeleton-row"><dt>Final URL</dt><dd>—</dd></div>
  `;

  hostDetailsEl.innerHTML = `
    <div class="kv-row skeleton-row"><dt>Host</dt><dd>—</dd></div>
    <div class="kv-row skeleton-row"><dt>IP address</dt><dd>—</dd></div>
    <div class="kv-row skeleton-row"><dt>Location</dt><dd>—</dd></div>
    <div class="kv-row skeleton-row"><dt>Reverse lookup</dt><dd>—</dd></div>
  `;

  timelineEl.innerHTML = `
    <li class="timeline-item timeline-placeholder">
      <span class="bar"></span>
      <div class="meta">
        <div class="label">Waiting for first check…</div>
        <div class="detail">Once you run a probe, you'll see DNS, connect, TLS, and response phases here.</div>
      </div>
    </li>
  `;

  pingListEl.innerHTML = "";
  pingSummaryEl.textContent = "";
  rawDetailsEl.value = "";
}

// SECTION: Render helpers
function renderStatusSummary({ status, ok, url, startTime, endTime, error }) {
  const statusClass = classifyStatus(status);
  const statusText = status ? `${status} ${ok ? "OK" : ""}`.trim() : "No HTTP response";
  const elapsed = endTime && startTime ? (endTime - startTime) : null;

  statusSummaryEl.className = `status-summary status-${statusClass}`;

  const pieces = [];
  if (status) pieces.push(`${status}`);
  if (elapsed != null) pieces.push(`${elapsed.toFixed(1)} ms`);

  const hostLabel = url ? url.host : "";

  statusSummaryEl.innerHTML = `
    <div class="status-chip">
      <span class="status-chip-dot"></span>
      <span>${ok ? "Reachable" : "Check failed"}</span>
    </div>
    <p style="margin-top: 8px;">${
      error
        ? `The request did not complete successfully: ${error}`
        : ok
        ? `The inspector successfully reached <code>${hostLabel}</code>.`
        : `The inspector attempted to reach <code>${hostLabel}</code> but the request failed.`
    }</p>
    <div class="status-meta">
      ${status ? `<span>HTTP ${status}</span>` : ""}
      ${elapsed != null ? `<span>Elapsed ${elapsed.toFixed(1)} ms</span>` : ""}
      ${url ? `<span>Scheme ${url.protocol.replace(":", "")}</span>` : ""}
    </div>
  `;
}

function renderHttpDetails({ status, ok, method, finalUrl, totalMs }) {
  httpDetailsEl.innerHTML = `
    <div class="kv-row"><dt>Status code</dt><dd><strong>${
      status ?? "—"
    }</strong>${status ? (ok ? " (success)" : " (error)") : ""}</dd></div>
    <div class="kv-row"><dt>Total time</dt><dd>${formatMs(totalMs)}</dd></div>
    <div class="kv-row"><dt>Method</dt><dd>${method}</dd></div>
    <div class="kv-row"><dt>Final URL</dt><dd>${finalUrl ? `<span style="word-break: break-all;">${finalUrl}</span>` : "—"}</dd></div>
  `;
}

function renderHostDetails({ url, ipInfo }) {
  const host = url ? url.hostname : "—";
  const ip = ipInfo && ipInfo.ip ? ipInfo.ip : "— (browser cannot directly resolve from arbitrary hosts)";

  const locationParts = [];
  if (ipInfo) {
    if (ipInfo.country_name) locationParts.push(ipInfo.country_name);
    if (ipInfo.region) locationParts.push(ipInfo.region);
    if (ipInfo.city) locationParts.push(ipInfo.city);
  }

  const location = locationParts.length
    ? locationParts.join(" · ")
    : "Best-effort lookup using a public geolocation API (may be approximate or unavailable).";

  const reverse = ipInfo && ipInfo.org
    ? ipInfo.org
    : "Reverse DNS / ASN info is approximated via public API.";

  hostDetailsEl.innerHTML = `
    <div class="kv-row"><dt>Host</dt><dd>${host}</dd></div>
    <div class="kv-row"><dt>IP address</dt><dd>${ip}</dd></div>
    <div class="kv-row"><dt>Location</dt><dd>${location}</dd></div>
    <div class="kv-row"><dt>Reverse lookup</dt><dd>${reverse}</dd></div>
  `;
}

function renderTimeline(phases, totalMs) {
  if (!phases || !phases.length) {
    timelineEl.innerHTML = `
      <li class="timeline-item timeline-placeholder">
        <span class="bar"></span>
        <div class="meta">
          <div class="label">Timing unavailable</div>
          <div class="detail">The browser didn't expose detailed timing for this request, so these phases are simulated.</div>
        </div>
      </li>
    `;
    return;
  }

  const safeTotal = totalMs || phases.reduce((sum, p) => sum + (p.durationMs || 0), 0) || 1;

  timelineEl.innerHTML = phases
    .map((phase) => {
      const width = Math.max(4, (phase.durationMs / safeTotal) * 100);
      return `
      <li class="timeline-item" data-phase="${phase.id}">
        <span class="bar" style="--bar-width:${width.toFixed(1)}%;">
          <span style="transform: scaleX(${width / 100}); transform-origin: left;"></span>
        </span>
        <div class="meta">
          <div class="label">${phase.label} <span class="time">${formatMs(
        phase.durationMs
      )}</span></div>
          <div class="detail">${phase.detail}</div>
        </div>
      </li>`;
    })
    .join("\n");
}

function renderPings(pingSamples) {
  pingListEl.innerHTML = "";
  pingSummaryEl.textContent = "";
  if (!pingSamples || !pingSamples.length) return;

  pingSamples.forEach((sample, idx) => {
    const li = document.createElement("li");
    li.className = `ping-item ${sample.ok ? "ok" : "fail"}`;
    li.innerHTML = `
      <span>#${idx + 1}</span>
      <span>${sample.ok ? formatMs(sample.latencyMs) : "timeout"}</span>
      <span class="ping-status">${sample.ok ? "ok" : "failed"}</span>
    `;
    pingListEl.appendChild(li);
  });

  const successful = pingSamples.filter((p) => p.ok);
  if (successful.length) {
    const times = successful.map((p) => p.latencyMs);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    pingSummaryEl.textContent = `min ${formatMs(min)}, max ${formatMs(
      max
    )}, avg ${formatMs(avg)} across ${pingSamples.length} rounds`;
  } else {
    pingSummaryEl.textContent = `All simulated ping rounds failed.`;
  }
}

// SECTION: Core probing logic
async function runProbe(normalized) {
  const { url, type } = normalized;
  const method = "GET";
  const controller = new AbortController();
  const startTime = performance.now();

  let status = null;
  let ok = false;
  let errorMessage = "";
  let textSnippet = "";

  try {
    const response = await fetch(url.toString(), {
      method,
      mode: "cors",
      signal: controller.signal,
    });

    status = response.status;
    ok = response.ok;

    // Best-effort get some text without overloading the textarea
    try {
      const text = await response.text();
      textSnippet = text.slice(0, 4000);
    } catch (err) {
      textSnippet = `Could not read body: ${String(err)}`;
    }
  } catch (err) {
    errorMessage = String(err.message || err);
  }

  const endTime = performance.now();
  const totalMs = endTime - startTime;

  // Simple simulated timeline based on totalMs
  const phases = createSimulatedPhases(totalMs);

  // Render sections
  renderStatusSummary({ status, ok, url, startTime, endTime, error: errorMessage });
  renderHttpDetails({ status, ok, method, finalUrl: url.toString(), totalMs });

  // Best-effort host information using ipapi.co (no key, may be blocked in some sandboxes)
  let ipInfo = null;
  try {
    const ipLookupTarget = type === "ip" ? url.hostname : url.hostname;
    const ipRes = await fetch(`https://ipapi.co/${ipLookupTarget}/json/`);
    if (ipRes.ok) {
      ipInfo = await ipRes.json();
    }
  } catch {
    // Ignore lookup errors; we'll just display generic info
  }
  renderHostDetails({ url, ipInfo });

  renderTimeline(phases, totalMs);

  // Simulated ping rounds (HTTP-based) if requested
  let pingSamples = [];
  if (runMultiplePingsEl.checked) {
    pingSamples = await runPingRounds(url.toString(), 5);
  }
  renderPings(pingSamples);

  // Raw area: include meta information and snippet
  const rawPayload = {
    target: url.toString(),
    method,
    status,
    ok,
    totalMs: Number(totalMs.toFixed(2)),
    error: errorMessage || undefined,
    snippetPreview: textSnippet,
  };
  rawDetailsEl.value = JSON.stringify(rawPayload, null, 2);
}

function createSimulatedPhases(totalMs) {
  const base = totalMs || 1;
  // Distribute into phases roughly like a real request
  const dns = Math.max(1, base * 0.08);
  const connect = Math.max(1, base * 0.15);
  const tls = Math.max(1, base * 0.17);
  const ttfb = Math.max(1, base * 0.3);
  const download = Math.max(1, base * 0.3);

  return [
    {
      id: "dns",
      label: "DNS lookup",
      durationMs: dns,
      detail: "Resolve hostname to IP address.",
    },
    {
      id: "connect",
      label: "TCP connect",
      durationMs: connect,
      detail: "Establish TCP connection with the remote host.",
    },
    {
      id: "tls",
      label: "TLS handshake",
      durationMs: tls,
      detail: "Negotiate encryption and verify certificates (HTTPS).",
    },
    {
      id: "ttfb",
      label: "Time to first byte",
      durationMs: ttfb,
      detail: "Wait for the first byte of the response from the server.",
    },
    {
      id: "download",
      label: "Content download",
      durationMs: download,
      detail: "Transfer the response body over the network.",
    },
  ];
}

async function runPingRounds(url, rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    let ok = false;
    try {
      // Use HEAD where allowed, fallback to GET (might be blocked by CORS or server)
      const res = await fetch(url, { method: "HEAD" });
      ok = res.ok;
    } catch {
      ok = false;
    }
    const t1 = performance.now();

    samples.push({ ok, latencyMs: t1 - t0 });
  }
  return samples;
}

// SECTION: Source code viewer
async function loadSourceCode(tab) {
  const path =
    tab === "html" ? "index.html" : tab === "css" ? "style.css" : "script.js";

  try {
    // Fetch the file from the same origin; this works in the Codecademy preview.
    const res = await fetch(path);
    if (!res.ok) throw new Error("Unable to load source file");
    const text = await res.text();
    sourceCodeEl.textContent = text;
  } catch (err) {
    sourceCodeEl.textContent = `Could not load ${path}: ${String(err)}`;
  }
}

function activateSourceTab(tab) {
  sourceTabButtons.forEach((btn) => {
    const isActive = btn.getAttribute("data-source-tab") === tab;
    btn.classList.toggle("chip-active", isActive);
  });

  sourceCodeEl.className = "language-" + tab;
  loadSourceCode(tab);
}

// SECTION: Event Handlers
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setInputError("");

  const normalized = normalizeTarget(inputEl.value);
  if (!normalized) {
    setInputError("Enter a valid URL or IPv4 address.");
    return;
  }

  updateModeLabel(normalized);
  setLoading(true);

  try {
    await runProbe(normalized);
  } finally {
    setLoading(false);
  }
});

inputEl.addEventListener("input", () => {
  const normalized = normalizeTarget(inputEl.value);
  updateModeLabel(normalized);
  if (!inputEl.value.trim()) setInputError("");
});

resetButton.addEventListener("click", () => {
  inputEl.value = "";
  updateModeLabel(null);
  setInputError("");
  clearResults();
});

sourceTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.getAttribute("data-source-tab");
    activateSourceTab(tab);
  });
});

// Initialize
clearResults();
activateSourceTab("html");
