/**
 * LifeBridge — Client-side application logic
 * Vanilla JS, no frameworks. Handles form submission, API calls,
 * result rendering, and sample scenario population.
 */

// Sample scenarios for quick-select buttons
const SCENARIOS = {
  medical: `my dad 67 yrs old been diabetic for 15 years on metformin 1000mg twice daily and glipizide 5mg. fell down the stairs this morning hit his head on the railing, theres a cut on his forehead still bleeding a little. but he also told me his chest has been hurting for 2 days he didnt tell anyone. he takes warfarin for his afib and i think baby aspirin too. his blood sugar was 280 this morning he forgot his insulin last night. hes sitting in the kitchen saying hes fine but hes sweating a lot and looks pale. mom says his BP machine showed 180/95. what do i do`,

  disaster: `Massive flooding in residential sector 14 after the dam spillway released. Water level 4 feet in the main road. Power is completely out since 3am across 6 blocks. Three families are stranded on the second floor of the apartment complex on MG Road — one of them has an elderly woman (Mrs. Sharma, 78) who needs dialysis tomorrow and her machine is on the ground floor which is underwater. Two kids under 5 with the Reddy family. cell towers are intermittent. the bridge on NH-44 near the hospital is reportedly cracked. local fire station is overwhelmed. some cars are floating. a gas leak was reported near the petrol pump on 3rd cross.`,

  emergency: `car accident just happened on highway 9 near the overpass. looks like 3 vehicles involved a truck rear-ended a sedan which pushed into a motorcycle. motorcycle rider is on the ground not moving, helmet came off. the sedan driver is conscious but trapped, steering wheel is pressing against her chest she says she cant breathe well. a child in the backseat of the sedan is crying but has blood on his face. truck driver walked out seems ok but confused and stumbling. theres fuel leaking from the sedan i can smell it. traffic is backed up for a mile. another car almost hit the scene. its getting dark and no one has put out flares.`,

  traffic: JSON.stringify({
    location: 'NH-48 near Bengaluru Outer Ring Road, km marker 42',
    incident: 'Multi-vehicle pile-up: 2 trucks and a bus',
    severity: 'CRITICAL',
    affectedRoads: ['NH-48 North', 'ORR East Ramp'],
    direction: 'Northbound completely blocked',
    vehiclesInvolved: 3,
    casualties: '7 injured, 1 unresponsive',
    blockageLength: '800 metres',
    hazards: ['Diesel spill across 3 lanes', 'Broken glass debris', 'Bus on its side blocking emergency lane'],
    timestamp: new Date().toISOString(),
  }, null, 2),

  weather: JSON.stringify({
    location: 'Chennai Metropolitan Area',
    temperature: 38,
    feelsLike: 46,
    conditions: 'Extreme heat wave with very high humidity',
    windSpeed: 8,
    humidity: 92,
    pressure: 998,
    visibility: 3,
    uvIndex: 11,
    alerts: [
      'RED HEAT ALERT — Dangerous heat index above 55°C expected between 11am–4pm',
      'DEHYDRATION WARNING — Outdoor activity strongly discouraged',
      'POWER GRID STRAIN — Rolling outages possible 12pm–5pm'
    ],
    timestamp: new Date().toISOString(),
  }, null, 2),

  news: JSON.stringify({
    source: 'City News Wire',
    timestamp: new Date().toISOString(),
    location: 'Riverside District, Sector 12',
    affectedArea: '3 km evacuation radius near old chemical warehouse',
    category: 'Industrial incident',
    urgency: 'HIGH',
    headline: 'Breaking: Smoke plume seen after explosion at storage facility near residential zone',
    summary: 'Local channels report multiple injuries and traffic diversions; schools instructed to shelter in place.',
    body: 'Eyewitnesses reported two loud blasts around 07:40. Fire response teams and ambulances are on site. Officials have not yet confirmed chemical type. Residents are being asked to avoid low-lying roads and keep windows closed until air monitoring results are published.',
  }, null, 2),

  publicHealth: `URGENT PUBLIC HEALTH NOTICE — Suspected norovirus outbreak traced to buffet meals served at Hotel Grandeur on 18 March. As of today 47 reported cases, 12 hospitalized with severe dehydration. Symptoms: sudden onset vomiting, diarrhoea, cramps, low-grade fever. Median onset 24hrs post-meal. Age range 8–78. Three cases are elderly patients with underlying renal conditions. The hotel kitchen remains open. Water supply to adjacent residential block shared with hotel plumbing — contamination of mains not ruled out. Local lab confirmation pending.`,

  infrastructure: `INFRASTRUCTURE ALERT — Major gas pipeline rupture reported at Junction 5, Industrial Sector 7. A 500m exclusion zone has been set. Two schools and a hospital are within 300m. The leak was first detected at 0610hrs; smell reported across 1.5km radius. Fire crews on scene but cannot approach; need Gas Authority emergency team. Power substation adjacent to rupture site still active — risk of ignition. 3,000 residents in the area without hot water or heating, temperature currently 4°C at night. Traffic on the industrial bypass diverted through residential streets causing gridlock near the hospital.`,
};

// DOM elements
const form = document.getElementById('triage-form');
const textarea = document.getElementById('user-input');
const submitBtn = document.getElementById('submit-btn');
const btnText = submitBtn.querySelector('.btn-text');
const btnLoading = submitBtn.querySelector('.btn-loading');
const charCount = document.querySelector('.char-count');
const resultsSection = document.getElementById('results');
const resultsContent = document.getElementById('results-content');
const errorDisplay = document.getElementById('error-display');
const errorMessage = document.getElementById('error-message');
const imageInput = document.getElementById('image-input');
const imageFileName = document.getElementById('image-file-name');
const clearImageBtn = document.getElementById('clear-image-btn');

hideError();

// ── Voice Input (Web Speech API) ────────────────────────────────
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let hasMicPermission = false;

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      message: 'Microphone access is not supported in this browser. Use Chrome or Edge on HTTPS.',
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    hasMicPermission = true;
    return { ok: true };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const blocked = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name);
    return {
      ok: false,
      message: blocked
        ? 'Microphone permission was denied. Please allow mic access in browser site settings and try again.'
        : 'Unable to access microphone. Please check your audio device and browser permissions.',
    };
  }
}

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  // Inject microphone button next to the textarea
  const voiceBtn = document.createElement('button');
  voiceBtn.type = 'button';
  voiceBtn.id = 'voice-btn';
  voiceBtn.className = 'voice-btn';
  voiceBtn.setAttribute('aria-label', 'Start voice input');
  voiceBtn.innerHTML = '<span aria-hidden="true">🎤</span> Speak';

  const inputSection = document.querySelector('.input-section');
  const inputFooter = document.querySelector('.input-footer');
  if (inputFooter && inputSection) {
    inputFooter.insertBefore(voiceBtn, inputFooter.firstChild);
  }

  recognition.onresult = (event) => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    textarea.value = transcript;
    textarea.dispatchEvent(new Event('input'));
  };

  recognition.onend = () => {
    isRecording = false;
    voiceBtn.innerHTML = '<span aria-hidden="true">🎤</span> Speak';
    voiceBtn.classList.remove('recording');
    voiceBtn.setAttribute('aria-label', 'Start voice input');
  };

  recognition.onerror = (event) => {
    isRecording = false;
    voiceBtn.innerHTML = '<span aria-hidden="true">🎤</span> Speak';
    voiceBtn.classList.remove('recording');
    if (event.error !== 'no-speech') {
      showError(`Microphone error: ${event.error}. Try typing instead.`);
    }
  };

  voiceBtn.addEventListener('click', async () => {
    if (isRecording) {
      recognition.stop();
    } else {
      hideError();

      if (!hasMicPermission) {
        const permission = await ensureMicrophonePermission();
        if (!permission.ok) {
          showError(permission.message);
          return;
        }
      }

      try {
        recognition.start();
        isRecording = true;
        voiceBtn.innerHTML = '<span aria-hidden="true">⏹️</span> Stop';
        voiceBtn.classList.add('recording');
        voiceBtn.setAttribute('aria-label', 'Stop voice recording');
      } catch {
        showError('Could not start voice input. Refresh the page and try again.');
      }
    }
  });
}
let pendingImageBase64 = null;
let pendingImageMimeType = null;

// Image upload handling
imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showError('Please select a valid image file (JPEG, PNG, WebP).');
    imageInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Strip the "data:<mime>;base64," prefix
    const commaIdx = dataUrl.indexOf(',');
    pendingImageBase64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    pendingImageMimeType = file.type;
    imageFileName.textContent = file.name;
    clearImageBtn.hidden = false;
  };
  reader.readAsDataURL(file);
});

// Clear image button
clearImageBtn.addEventListener('click', () => {
  pendingImageBase64 = null;
  pendingImageMimeType = null;
  imageInput.value = '';
  imageFileName.textContent = '';
  clearImageBtn.hidden = true;
});

// Character count
textarea.addEventListener('input', () => {
  const len = textarea.value.length;
  charCount.textContent = `${len} / 5000`;
});

// Scenario buttons
document.querySelectorAll('.scenario-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const scenario = btn.dataset.scenario;
    if (SCENARIOS[scenario]) {
      document.querySelectorAll('.scenario-btn').forEach(otherBtn => {
        otherBtn.classList.remove('active');
      });
      btn.classList.add('active');
      textarea.value = SCENARIOS[scenario];
      textarea.dispatchEvent(new Event('input'));
      textarea.focus();
      hideError();
    }
  });
});

// Form submission
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = textarea.value.trim();

  if (!input) {
    showError('Please describe a situation to analyze.');
    return;
  }

  setLoading(true);
  hideError();
  hideResults();

  try {
    const body = { input };

    if (pendingImageBase64) {
      body.imageBase64  = pendingImageBase64;
      body.imageMimeType = pendingImageMimeType ?? 'image/jpeg';
    }

    const response = await fetch('/api/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const serverMessage =
        typeof data?.error === 'string' && data.error.trim().length > 0
          ? data.error.trim()
          : '';

      const rateLimitLike =
        response.status === 429
        || data?.code === 'RATE_LIMITED'
        || /\b429\b|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(serverMessage);

      if (rateLimitLike) {
        throw new Error('Too many requests right now. Please wait a few seconds and try again.');
      }

      throw new Error(serverMessage || 'Something went wrong. Please try again.');
    }

    renderActionPlan(data.actionPlan, data.inputType, data.translation, data.locationEnriched);
    hideError();
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : '';
    const cleanedMessage = /\b429\b|rate\s*limit|too\s*many\s*requests|quota\s*exceeded/i.test(rawMessage)
      ? 'Too many requests right now. Please wait a few seconds and try again.'
      : rawMessage;
    showError(cleanedMessage || 'Failed to connect to the server. Please try again.');
  } finally {
    setLoading(false);
  }
});

/**
 * Render the structured action plan in the results section.
 */
function renderActionPlan(plan, inputType, translation, locationEnriched) {
  const severityClass = (plan.severity || 'moderate').toLowerCase();
  const severityIcon = plan.severityMeta?.icon || '🔵';

  // Optional metadata badges
  let metaBadges = '';
  if (translation?.wasTranslated) {
    metaBadges += `<span class="meta-badge translate-badge" title="Input was translated from ${translation.sourceLanguageName}">🌐 Translated from ${translation.sourceLanguageName}</span>`;
  }
  if (locationEnriched) {
    metaBadges += `<span class="meta-badge location-badge" title="Location detected and enriched with nearby services">📍 Location enriched</span>`;
  }

  let html = `
    <article class="action-plan" aria-label="Triage action plan">
      <div class="severity-banner ${severityClass}" role="status">
        <span aria-hidden="true">${severityIcon}</span>
        <span>Severity: ${plan.severity}</span>
      </div>
      ${metaBadges ? `<div class="meta-badges">${metaBadges}</div>` : ''}
      <div class="plan-body">
        <h4 class="plan-title">${escapeHtml(plan.title || 'Assessment')}</h4>
        <p class="plan-summary">${escapeHtml(plan.summary || '')}</p>
  `;
  // Key Findings
  if (plan.keyFindings && plan.keyFindings.length > 0) {
    html += `
      <div class="plan-section">
        <h5 class="plan-section-title">Key Findings</h5>
        ${plan.keyFindings.map(f => `
          <div class="finding-item risk-${(f.risk || 'low').toLowerCase()}" role="listitem">
            <span class="finding-category">${escapeHtml(f.category || '')}</span>
            <span class="finding-detail">${escapeHtml(f.detail || '')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Action Steps
  if (plan.actionSteps && plan.actionSteps.length > 0) {
    html += `
      <div class="plan-section">
        <h5 class="plan-section-title">Action Steps</h5>
        ${plan.actionSteps.map((step, i) => `
          <div class="action-step" role="listitem">
            <span class="step-number" aria-label="Step ${i + 1}">${i + 1}</span>
            <div class="step-content">
              <div class="step-action">${escapeHtml(step.action || '')}</div>
              ${step.reasoning ? `<div class="step-reasoning">${escapeHtml(step.reasoning)}</div>` : ''}
              ${step.timeframe ? `<span class="step-timeframe">${escapeHtml(step.timeframe)}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Warnings
  if (plan.warnings && plan.warnings.length > 0) {
    html += `
      <div class="plan-section">
        <h5 class="plan-section-title">⚠️ Warnings</h5>
        ${plan.warnings.map(w => `
          <div class="warning-item" role="alert">
            <span>${escapeHtml(w)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Emergency Contacts
  if (plan.emergencyContacts && plan.emergencyContacts.length > 0) {
    html += `
      <div class="plan-section">
        <h5 class="plan-section-title">📞 Emergency Contacts</h5>
        ${plan.emergencyContacts.map(c => `
          <div class="contact-item">
            <div>
              <div class="contact-name">${escapeHtml(c.name || '')}</div>
              <div class="contact-when">${escapeHtml(c.when || '')}</div>
            </div>
            <span class="contact-number">${escapeHtml(c.number || '')}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Disclaimer
  html += `
      <div class="disclaimer" role="note">
        <strong>⚕️ Disclaimer:</strong> ${escapeHtml(plan.disclaimer || 'This is AI-generated guidance only. Always consult qualified professionals.')}
      </div>
      </div>
    </article>
  `;

  resultsContent.innerHTML = html;
  resultsSection.hidden = false;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// --- Utility functions ---

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnText.hidden = loading;
  btnLoading.hidden = !loading;
}

function showError(msg) {
  const normalized = typeof msg === 'string' ? msg.trim() : '';
  errorMessage.textContent = normalized || 'Something went wrong. Please try again.';
  errorDisplay.hidden = false;
}

function hideError() {
  errorDisplay.hidden = true;
}

function hideResults() {
  resultsSection.hidden = true;
  resultsContent.innerHTML = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
