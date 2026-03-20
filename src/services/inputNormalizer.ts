/**
 * @module inputNormalizer
 * @description Normalizes diverse real-world input formats into enriched
 * text descriptions that the Gemini triage pipeline can process.
 *
 * LifeBridge is a universal bridge between chaotic, multi-modal human intent
 * and complex emergency systems. This module enables that universality by
 * accepting inputs that go far beyond plain text:
 *
 *   - Plain text               — natural language descriptions
 *   - Weather alert data       — JSON from weather APIs / IoT stations
 *   - Traffic incident feeds   — JSON from traffic management systems
 *   - Structured medical records (EHR-style JSON)
 *   - News / social media alerts (JSON with headline + body)
 *   - IoT sensor readings      — temperature, air-quality, seismic
 *   - Voice transcript metadata — STT output with confidence scores
 *
 * All formats are normalized into a single rich text string that the
 * downstream classifier and prompt-builder can consume without change.
 */

// ────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────

/** Supported structured input formats. */
export type InputFormat =
  | 'text'
  | 'weather'
  | 'traffic'
  | 'medical-record'
  | 'news'
  | 'iot-sensor'
  | 'voice-transcript'
  | 'audio'; // base64 audio → processed via Speech-to-Text before the triage pipeline

// ─── Structured input schemas ─────────────────────────────────

export interface WeatherData {
  location?: string;
  temperature?: number | string;
  feelsLike?: number | string;
  conditions?: string;
  windSpeed?: number | string;
  windDirection?: string;
  humidity?: number | string;
  pressure?: number | string;
  visibility?: number | string;
  uvIndex?: number | string;
  alerts?: string[];
  timestamp?: string;
}

export interface TrafficData {
  location?: string;
  incident?: string;
  /** e.g. 'MINOR' | 'MODERATE' | 'SERIOUS' | 'CRITICAL' */
  severity?: string;
  affectedRoads?: string[];
  direction?: string;
  vehiclesInvolved?: number;
  casualties?: number | string;
  blockageLength?: string;
  hazards?: string[];
  timestamp?: string;
}

export interface MedicalRecord {
  patientName?: string;
  patientAge?: number | string;
  patientSex?: string;
  bloodType?: string;
  conditions?: string[];
  medications?: Array<{ name: string; dose?: string; frequency?: string }>;
  allergies?: string[];
  vitals?: {
    bloodPressure?: string;
    pulse?: number | string;
    temperature?: number | string;
    respiratoryRate?: number | string;
    oxygenSaturation?: number | string;
    weight?: string;
    height?: string;
  };
  chiefComplaint?: string;
  history?: string;
  recentLabResults?: Record<string, string | number>;
}

export interface NewsItem {
  headline?: string;
  body?: string;
  summary?: string;
  location?: string;
  affectedArea?: string;
  timestamp?: string;
  source?: string;
  category?: string;
  urgency?: string;
}

export interface IoTSensorData {
  deviceId?: string;
  deviceType?: string;
  location?: string;
  readings?: Record<string, number | string>;
  unit?: Record<string, string>;
  alerts?: string[];
  timestamp?: string;
}

export interface VoiceTranscript {
  transcript: string;
  language?: string;
  confidence?: number;
  durationSeconds?: number;
}

export type StructuredInput =
  | WeatherData
  | TrafficData
  | MedicalRecord
  | NewsItem
  | IoTSensorData
  | VoiceTranscript
  | Record<string, unknown>;

// ────────────────────────────────────────────────────────────────
// Format detection
// ────────────────────────────────────────────────────────────────

/**
 * Detect the format of a raw input string.
 *
 * If the input is valid JSON containing known schema keys, the
 * corresponding format is returned. Otherwise falls back to 'text'.
 *
 * @param raw - Raw string from the client
 * @returns Detected {@link InputFormat}
 */
export function detectInputFormat(raw: string): InputFormat {
  const trimmed = (raw ?? '').trim();
  if (!trimmed.startsWith('{')) {
    return 'text';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return 'text';
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'text';
  }

  const keys = Object.keys(parsed as object);

  if (keys.some(k => ['transcript'].includes(k))) {
    return 'voice-transcript';
  }
  if (keys.some(k => ['conditions', 'temperature', 'humidity', 'windSpeed', 'uvIndex', 'feelsLike', 'alerts'].includes(k)) &&
      !keys.some(k => ['chiefComplaint', 'medications', 'bloodType'].includes(k))) {
    return 'weather';
  }
  if (keys.some(k => ['incident', 'affectedRoads', 'hazards', 'blockageLength', 'vehiclesInvolved'].includes(k))) {
    return 'traffic';
  }
  if (keys.some(k => ['chiefComplaint', 'medications', 'vitals', 'allergies', 'bloodType', 'patientAge'].includes(k))) {
    return 'medical-record';
  }
  if (keys.some(k => ['headline', 'body', 'urgency', 'affectedArea', 'source'].includes(k))) {
    return 'news';
  }
  if (keys.some(k => ['readings', 'deviceId', 'deviceType'].includes(k))) {
    return 'iot-sensor';
  }

  return 'text';
}

// ────────────────────────────────────────────────────────────────
// Format-specific normalizers (each returns enriched plain text)
// ────────────────────────────────────────────────────────────────

/**
 * Convert a structured weather data object into a rich text description.
 *
 * @param data - Weather readings and active alerts
 * @returns Multi-line string ready for triage classification
 */
export function normalizeWeatherData(data: WeatherData): string {
  const parts: string[] = ['[WEATHER ALERT DATA]'];
  if (data.location) parts.push(`Location: ${data.location}`);
  if (data.timestamp) parts.push(`Time: ${data.timestamp}`);
  if (data.temperature !== undefined) parts.push(`Temperature: ${data.temperature}°`);
  if (data.feelsLike !== undefined) parts.push(`Feels like: ${data.feelsLike}°`);
  if (data.conditions) parts.push(`Conditions: ${data.conditions}`);
  if (data.windSpeed !== undefined) {
    parts.push(`Wind: ${data.windSpeed} km/h${data.windDirection ? ` from ${data.windDirection}` : ''}`);
  }
  if (data.humidity !== undefined) parts.push(`Humidity: ${data.humidity}%`);
  if (data.pressure !== undefined) parts.push(`Pressure: ${data.pressure} hPa`);
  if (data.visibility !== undefined) parts.push(`Visibility: ${data.visibility} km`);
  if (data.uvIndex !== undefined) parts.push(`UV Index: ${data.uvIndex}`);
  if (data.alerts && data.alerts.length > 0) {
    parts.push(`\nACTIVE ALERTS:\n${data.alerts.map(a => `- ${a}`).join('\n')}`);
  }
  return parts.join('\n');
}

/**
 * Convert a structured traffic incident object into a rich text description.
 *
 * @param data - Traffic incident report (location, vehicles, hazards, etc.)
 * @returns Multi-line string ready for triage classification
 */
export function normalizeTrafficData(data: TrafficData): string {
  const parts: string[] = ['[TRAFFIC INCIDENT REPORT]'];
  if (data.location) parts.push(`Location: ${data.location}`);
  if (data.timestamp) parts.push(`Reported at: ${data.timestamp}`);
  if (data.incident) parts.push(`Incident: ${data.incident}`);
  if (data.severity) parts.push(`Severity: ${data.severity}`);
  if (data.direction) parts.push(`Direction: ${data.direction}`);
  if (data.affectedRoads && data.affectedRoads.length > 0) {
    parts.push(`Affected roads: ${data.affectedRoads.join(', ')}`);
  }
  if (data.vehiclesInvolved !== undefined) parts.push(`Vehicles involved: ${data.vehiclesInvolved}`);
  if (data.casualties !== undefined) parts.push(`Casualties reported: ${data.casualties}`);
  if (data.blockageLength) parts.push(`Traffic blockage: ${data.blockageLength}`);
  if (data.hazards && data.hazards.length > 0) {
    parts.push(`\nHAZARDS:\n${data.hazards.map(h => `- ${h}`).join('\n')}`);
  }
  return parts.join('\n');
}

/**
 * Convert a structured medical record object into a rich text description.
 *
 * @param data - EHR-style medical record with patient details, vitals, medications
 * @returns Multi-line string ready for triage classification
 */
export function normalizeMedicalRecord(data: MedicalRecord): string {
  const parts: string[] = ['[MEDICAL RECORD]'];
  if (data.patientName) parts.push(`Patient: ${data.patientName}`);
  if (data.patientAge !== undefined) parts.push(`Age: ${data.patientAge}`);
  if (data.patientSex) parts.push(`Sex: ${data.patientSex}`);
  if (data.bloodType) parts.push(`Blood type: ${data.bloodType}`);
  if (data.chiefComplaint) parts.push(`\nChief Complaint: ${data.chiefComplaint}`);
  if (data.conditions && data.conditions.length > 0) {
    parts.push(`Medical conditions: ${data.conditions.join(', ')}`);
  }
  if (data.medications && data.medications.length > 0) {
    const medStr = data.medications
      .map(m => `${m.name}${m.dose ? ` ${m.dose}` : ''}${m.frequency ? ` (${m.frequency})` : ''}`)
      .join(', ');
    parts.push(`Current medications: ${medStr}`);
  }
  if (data.allergies && data.allergies.length > 0) {
    parts.push(`Allergies: ${data.allergies.join(', ')}`);
  }
  if (data.vitals) {
    const v = data.vitals;
    const vp: string[] = [];
    if (v.bloodPressure) vp.push(`BP ${v.bloodPressure}`);
    if (v.pulse !== undefined) vp.push(`Pulse ${v.pulse} bpm`);
    if (v.temperature !== undefined) vp.push(`Temp ${v.temperature}°`);
    if (v.respiratoryRate !== undefined) vp.push(`RR ${v.respiratoryRate}/min`);
    if (v.oxygenSaturation !== undefined) vp.push(`SpO2 ${v.oxygenSaturation}%`);
    if (vp.length > 0) parts.push(`Vitals: ${vp.join(', ')}`);
  }
  if (data.history) parts.push(`History: ${data.history}`);
  if (data.recentLabResults && Object.keys(data.recentLabResults).length > 0) {
    parts.push(`\nLab Results:`);
    for (const [k, v] of Object.entries(data.recentLabResults)) {
      parts.push(`  ${k}: ${v}`);
    }
  }
  return parts.join('\n');
}

/**
 * Convert a structured news or alert item into a rich text description.
 *
 * @param data - News article / alert with headline, summary, and urgency
 * @returns Multi-line string ready for triage classification
 */
export function normalizeNewsItem(data: NewsItem): string {
  const parts: string[] = ['[NEWS / ALERT REPORT]'];
  if (data.source) parts.push(`Source: ${data.source}`);
  if (data.timestamp) parts.push(`Published: ${data.timestamp}`);
  if (data.location) parts.push(`Location: ${data.location}`);
  if (data.affectedArea) parts.push(`Affected area: ${data.affectedArea}`);
  if (data.category) parts.push(`Category: ${data.category}`);
  if (data.urgency) parts.push(`Urgency: ${data.urgency}`);
  if (data.headline) parts.push(`\nHeadline: ${data.headline}`);
  if (data.summary) parts.push(`Summary: ${data.summary}`);
  if (data.body) parts.push(`\nFull report:\n${data.body}`);
  return parts.join('\n');
}

/**
 * Convert an IoT sensor reading into a rich text description.
 *
 * @param data - Sensor device data with readings and active alerts
 * @returns Multi-line string ready for triage classification
 */
export function normalizeIoTSensorData(data: IoTSensorData): string {
  const parts: string[] = ['[IoT SENSOR READING]'];
  if (data.deviceId) parts.push(`Device: ${data.deviceId}`);
  if (data.deviceType) parts.push(`Type: ${data.deviceType}`);
  if (data.location) parts.push(`Location: ${data.location}`);
  if (data.timestamp) parts.push(`Timestamp: ${data.timestamp}`);
  if (data.readings && Object.keys(data.readings).length > 0) {
    parts.push('Readings:');
    for (const [key, value] of Object.entries(data.readings)) {
      const unit = data.unit?.[key] ?? '';
      parts.push(`  ${key}: ${value}${unit ? ` ${unit}` : ''}`);
    }
  }
  if (data.alerts && data.alerts.length > 0) {
    parts.push(`\nSENSOR ALERTS:\n${data.alerts.map(a => `- ${a}`).join('\n')}`);
  }
  return parts.join('\n');
}

/**
 * Convert a voice transcript object (STT output) into a rich text description.
 *
 * @param data - Transcript with optional confidence and language metadata
 * @returns Multi-line string ready for triage classification
 */
export function normalizeVoiceTranscript(data: VoiceTranscript): string {
  const parts: string[] = ['[VOICE TRANSCRIPT]'];
  if (data.language) parts.push(`Language: ${data.language}`);
  if (data.durationSeconds !== undefined) parts.push(`Duration: ${data.durationSeconds}s`);
  if (data.confidence !== undefined) {
    parts.push(`Confidence: ${Math.round(data.confidence * 100)}%`);
  }
  parts.push(`\nTranscript:\n${data.transcript}`);
  return parts.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────

/**
 * Normalize any supported input format into a rich text string.
 *
 * If `format` is omitted, it is auto-detected by inspecting the input
 * for JSON structure and known schema keys (see {@link detectInputFormat}).
 *
 * Plain text is returned as-is. Structured JSON is converted to a
 * human-readable, classification-friendly text block.
 *
 * @param raw    - Raw input from the client (text or JSON string)
 * @param format - Optional explicit format override
 * @returns      Normalized text ready for classification and prompting
 */
export function normalizeInput(raw: string, format?: InputFormat): string {
  if (!raw || typeof raw !== 'string') return '';

  const resolvedFormat = format ?? detectInputFormat(raw);

  if (resolvedFormat === 'text') {
    return raw;
  }

  let parsed: StructuredInput;
  try {
    parsed = JSON.parse(raw.trim()) as StructuredInput;
  } catch {
    // Not valid JSON despite the format hint — fall back to raw text
    return raw;
  }

  switch (resolvedFormat) {
    case 'weather':          return normalizeWeatherData(parsed as WeatherData);
    case 'traffic':          return normalizeTrafficData(parsed as TrafficData);
    case 'medical-record':   return normalizeMedicalRecord(parsed as MedicalRecord);
    case 'news':             return normalizeNewsItem(parsed as NewsItem);
    case 'iot-sensor':       return normalizeIoTSensorData(parsed as IoTSensorData);
    case 'voice-transcript': return normalizeVoiceTranscript(parsed as VoiceTranscript);
    default:                 return raw;
  }
}
