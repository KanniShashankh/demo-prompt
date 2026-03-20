/**
 * @module inputNormalizer.test
 * @description Comprehensive unit tests for the input normalizer service.
 *
 * Tests cover:
 *   - detectInputFormat: auto-detection of all supported formats
 *   - normalizeWeatherData: weather JSON → enriched text
 *   - normalizeTrafficData: traffic JSON → enriched text
 *   - normalizeMedicalRecord: EHR JSON → enriched text
 *   - normalizeNewsItem: news JSON → enriched text
 *   - normalizeIoTSensorData: sensor JSON → enriched text
 *   - normalizeVoiceTranscript: STT JSON → enriched text
 *   - normalizeInput: main entry — format detection + dispatch + fallbacks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectInputFormat,
  normalizeInput,
  normalizeWeatherData,
  normalizeTrafficData,
  normalizeMedicalRecord,
  normalizeNewsItem,
  normalizeIoTSensorData,
  normalizeVoiceTranscript,
} from '../services/inputNormalizer';

// ────────────────────────────────────────────────────────────────
// detectInputFormat
// ────────────────────────────────────────────────────────────────

describe('detectInputFormat', () => {
  it('should return "text" for plain text', () => {
    assert.equal(detectInputFormat('patient has fever'), 'text');
  });

  it('should return "text" for empty string', () => {
    assert.equal(detectInputFormat(''), 'text');
  });

  it('should return "text" for whitespace', () => {
    assert.equal(detectInputFormat('   '), 'text');
  });

  it('should return "text" for invalid JSON that starts with {', () => {
    assert.equal(detectInputFormat('{ this is not json }'), 'text');
  });

  it('should return "text" for a JSON array (not an object)', () => {
    assert.equal(detectInputFormat('[{"a": 1}]'), 'text');
  });

  it('should detect "voice-transcript" format', () => {
    const raw = JSON.stringify({ transcript: 'hello', language: 'en', confidence: 0.95 });
    assert.equal(detectInputFormat(raw), 'voice-transcript');
  });

  it('should detect "weather" format', () => {
    const raw = JSON.stringify({ temperature: 38, humidity: 80, conditions: 'hot', windSpeed: 10 });
    assert.equal(detectInputFormat(raw), 'weather');
  });

  it('should detect "weather" format with alerts only', () => {
    const raw = JSON.stringify({ alerts: ['heat warning'], uvIndex: 11, feelsLike: 45 });
    assert.equal(detectInputFormat(raw), 'weather');
  });

  it('should detect "traffic" format', () => {
    const raw = JSON.stringify({ incident: 'car crash', affectedRoads: ['Highway 1'], vehiclesInvolved: 3 });
    assert.equal(detectInputFormat(raw), 'traffic');
  });

  it('should detect "medical-record" format', () => {
    const raw = JSON.stringify({ chiefComplaint: 'chest pain', medications: [], vitals: { pulse: 100 } });
    assert.equal(detectInputFormat(raw), 'medical-record');
  });

  it('should detect "medical-record" when patientAge is present', () => {
    const raw = JSON.stringify({ patientAge: 65, allergies: ['penicillin'], bloodType: 'O+' });
    assert.equal(detectInputFormat(raw), 'medical-record');
  });

  it('should detect "news" format', () => {
    const raw = JSON.stringify({ headline: 'Flooding in city', urgency: 'HIGH', affectedArea: 'Downtown' });
    assert.equal(detectInputFormat(raw), 'news');
  });

  it('should detect "iot-sensor" format', () => {
    const raw = JSON.stringify({ deviceId: 'sensor-001', readings: { co2: 450 }, deviceType: 'air-quality' });
    assert.equal(detectInputFormat(raw), 'iot-sensor');
  });

  it('should return "text" for unrecognized JSON object', () => {
    const raw = JSON.stringify({ foo: 'bar', baz: 42 });
    assert.equal(detectInputFormat(raw), 'text');
  });

  it('should prefer "medical-record" over "weather" when chiefComplaint is present alongside temperature', () => {
    // temperature could be a weather key, but chiefComplaint is a stronger medical-record signal
    const raw = JSON.stringify({
      chiefComplaint: 'High fever',
      medications: [],
      temperature: 39.5,  // spurious weather overlap (body temperature)
    });
    assert.equal(detectInputFormat(raw), 'medical-record');
  });

  it('should prefer "medical-record" over "weather" when bloodType is present', () => {
    const raw = JSON.stringify({ bloodType: 'O+', temperature: 38, patientAge: 55 });
    assert.equal(detectInputFormat(raw), 'medical-record');
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeWeatherData
// ────────────────────────────────────────────────────────────────

describe('normalizeWeatherData', () => {
  it('should include the [WEATHER ALERT DATA] header', () => {
    const result = normalizeWeatherData({});
    assert.ok(result.includes('[WEATHER ALERT DATA]'));
  });

  it('should include location when present', () => {
    const result = normalizeWeatherData({ location: 'Chennai' });
    assert.ok(result.includes('Chennai'));
  });

  it('should include temperature', () => {
    const result = normalizeWeatherData({ temperature: 42 });
    assert.ok(result.includes('42'));
  });

  it('should include wind speed and direction together', () => {
    const result = normalizeWeatherData({ windSpeed: 80, windDirection: 'NE' });
    assert.ok(result.includes('80'));
    assert.ok(result.includes('NE'));
  });

  it('should include wind speed without direction gracefully', () => {
    const result = normalizeWeatherData({ windSpeed: 50 });
    assert.ok(result.includes('50'));
    assert.ok(!result.includes('undefined'));
  });

  it('should list all active alerts', () => {
    const result = normalizeWeatherData({ alerts: ['Heat advisory', 'Power outage risk'] });
    assert.ok(result.includes('ACTIVE ALERTS'));
    assert.ok(result.includes('Heat advisory'));
    assert.ok(result.includes('Power outage risk'));
  });

  it('should not include undefined values in output', () => {
    const result = normalizeWeatherData({ temperature: undefined, humidity: undefined });
    assert.ok(!result.includes('undefined'));
  });

  it('should handle fully empty object', () => {
    const result = normalizeWeatherData({});
    assert.ok(result.trim().length > 0);
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeTrafficData
// ────────────────────────────────────────────────────────────────

describe('normalizeTrafficData', () => {
  it('should include the [TRAFFIC INCIDENT REPORT] header', () => {
    const result = normalizeTrafficData({});
    assert.ok(result.includes('[TRAFFIC INCIDENT REPORT]'));
  });

  it('should include incident description', () => {
    const result = normalizeTrafficData({ incident: 'Multi-vehicle pile-up' });
    assert.ok(result.includes('Multi-vehicle pile-up'));
  });

  it('should include number of vehicles involved', () => {
    const result = normalizeTrafficData({ vehiclesInvolved: 5 });
    assert.ok(result.includes('5'));
  });

  it('should list all affected roads', () => {
    const result = normalizeTrafficData({ affectedRoads: ['NH-48', 'ORR East'] });
    assert.ok(result.includes('NH-48'));
    assert.ok(result.includes('ORR East'));
  });

  it('should list all hazards', () => {
    const result = normalizeTrafficData({ hazards: ['Fuel spill', 'Debris on road'] });
    assert.ok(result.includes('HAZARDS'));
    assert.ok(result.includes('Fuel spill'));
    assert.ok(result.includes('Debris on road'));
  });

  it('should include casualties when present', () => {
    const result = normalizeTrafficData({ casualties: '3 injured' });
    assert.ok(result.includes('3 injured'));
  });

  it('should handle empty object without errors', () => {
    const result = normalizeTrafficData({});
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeMedicalRecord
// ────────────────────────────────────────────────────────────────

describe('normalizeMedicalRecord', () => {
  it('should include the [MEDICAL RECORD] header', () => {
    assert.ok(normalizeMedicalRecord({}).includes('[MEDICAL RECORD]'));
  });

  it('should include patient name and age', () => {
    const result = normalizeMedicalRecord({ patientName: 'Jane Doe', patientAge: 52 });
    assert.ok(result.includes('Jane Doe'));
    assert.ok(result.includes('52'));
  });

  it('should list all conditions', () => {
    const result = normalizeMedicalRecord({ conditions: ['Diabetes', 'Hypertension'] });
    assert.ok(result.includes('Diabetes'));
    assert.ok(result.includes('Hypertension'));
  });

  it('should list medications with dose and frequency', () => {
    const meds = [{ name: 'Metformin', dose: '1000mg', frequency: 'twice daily' }];
    const result = normalizeMedicalRecord({ medications: meds });
    assert.ok(result.includes('Metformin'));
    assert.ok(result.includes('1000mg'));
    assert.ok(result.includes('twice daily'));
  });

  it('should list medications by name only when dose is absent', () => {
    const meds = [{ name: 'Aspirin' }];
    const result = normalizeMedicalRecord({ medications: meds });
    assert.ok(result.includes('Aspirin'));
    assert.ok(!result.includes('undefined'));
  });

  it('should include allergies', () => {
    const result = normalizeMedicalRecord({ allergies: ['Penicillin', 'Sulfa'] });
    assert.ok(result.includes('Penicillin'));
    assert.ok(result.includes('Sulfa'));
  });

  it('should format vitals correctly', () => {
    const vitals = { bloodPressure: '180/95', pulse: 110, oxygenSaturation: 94 };
    const result = normalizeMedicalRecord({ vitals });
    assert.ok(result.includes('180/95'));
    assert.ok(result.includes('110'));
    assert.ok(result.includes('94'));
    assert.ok(!result.includes('undefined'));
  });

  it('should include lab results', () => {
    const result = normalizeMedicalRecord({ recentLabResults: { HbA1c: 9.2, creatinine: 1.8 } });
    assert.ok(result.includes('HbA1c'));
    assert.ok(result.includes('9.2'));
    assert.ok(result.includes('creatinine'));
  });

  it('should handle fully empty object without errors', () => {
    const result = normalizeMedicalRecord({});
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeNewsItem
// ────────────────────────────────────────────────────────────────

describe('normalizeNewsItem', () => {
  it('should include the [NEWS / ALERT REPORT] header', () => {
    assert.ok(normalizeNewsItem({}).includes('[NEWS / ALERT REPORT]'));
  });

  it('should include headline, summary, and body', () => {
    const result = normalizeNewsItem({
      headline: 'Flood warning issued',
      summary: 'Rivers rising fast',
      body: 'Detailed report here.',
    });
    assert.ok(result.includes('Flood warning issued'));
    assert.ok(result.includes('Rivers rising fast'));
    assert.ok(result.includes('Detailed report here.'));
  });

  it('should include source and urgency', () => {
    const result = normalizeNewsItem({ source: 'NDMA', urgency: 'CRITICAL' });
    assert.ok(result.includes('NDMA'));
    assert.ok(result.includes('CRITICAL'));
  });

  it('should include affected area', () => {
    const result = normalizeNewsItem({ affectedArea: 'Eastern Province' });
    assert.ok(result.includes('Eastern Province'));
  });

  it('should handle empty object without errors', () => {
    const result = normalizeNewsItem({});
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeIoTSensorData
// ────────────────────────────────────────────────────────────────

describe('normalizeIoTSensorData', () => {
  it('should include the [IoT SENSOR READING] header', () => {
    assert.ok(normalizeIoTSensorData({}).includes('[IoT SENSOR READING]'));
  });

  it('should include device id and type', () => {
    const result = normalizeIoTSensorData({ deviceId: 'DEV-007', deviceType: 'seismic' });
    assert.ok(result.includes('DEV-007'));
    assert.ok(result.includes('seismic'));
  });

  it('should include all readings with units', () => {
    const result = normalizeIoTSensorData({
      readings: { co2: 1200, pm25: 55 },
      unit: { co2: 'ppm', pm25: 'µg/m3' },
    });
    assert.ok(result.includes('co2'));
    assert.ok(result.includes('1200'));
    assert.ok(result.includes('ppm'));
    assert.ok(result.includes('pm25'));
    assert.ok(result.includes('55'));
  });

  it('should include readings without units gracefully', () => {
    const result = normalizeIoTSensorData({ readings: { temperature: 37.5 } });
    assert.ok(result.includes('temperature'));
    assert.ok(result.includes('37.5'));
    assert.ok(!result.includes('undefined'));
  });

  it('should list all sensor alerts', () => {
    const result = normalizeIoTSensorData({ alerts: ['CO2 critical', 'Smoke detected'] });
    assert.ok(result.includes('SENSOR ALERTS'));
    assert.ok(result.includes('CO2 critical'));
    assert.ok(result.includes('Smoke detected'));
  });

  it('should handle empty object without errors', () => {
    const result = normalizeIoTSensorData({});
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeVoiceTranscript
// ────────────────────────────────────────────────────────────────

describe('normalizeVoiceTranscript', () => {
  it('should include the [VOICE TRANSCRIPT] header', () => {
    const result = normalizeVoiceTranscript({ transcript: 'help' });
    assert.ok(result.includes('[VOICE TRANSCRIPT]'));
  });

  it('should include the transcript text', () => {
    const result = normalizeVoiceTranscript({ transcript: 'There is a fire in the building' });
    assert.ok(result.includes('There is a fire in the building'));
  });

  it('should include language and duration', () => {
    const result = normalizeVoiceTranscript({ transcript: 'test', language: 'hi-IN', durationSeconds: 12 });
    assert.ok(result.includes('hi-IN'));
    assert.ok(result.includes('12'));
  });

  it('should round confidence to whole percent', () => {
    const result = normalizeVoiceTranscript({ transcript: 'test', confidence: 0.9765 });
    assert.ok(result.includes('98%'));
  });

  it('should handle transcript with no optional fields', () => {
    const result = normalizeVoiceTranscript({ transcript: 'ambulance needed now' });
    assert.ok(result.includes('ambulance needed now'));
    assert.ok(!result.includes('undefined'));
  });
});

// ────────────────────────────────────────────────────────────────
// normalizeInput (main entry point)
// ────────────────────────────────────────────────────────────────

describe('normalizeInput', () => {
  it('should return empty string for null-like input', () => {
    assert.equal(normalizeInput(''), '');
    assert.equal(normalizeInput(null as unknown as string), '');
  });

  it('should return plain text unchanged', () => {
    const text = 'patient has fever and chest pain';
    assert.equal(normalizeInput(text), text);
  });

  it('should auto-detect and normalize voice transcript JSON', () => {
    const raw = JSON.stringify({ transcript: 'I need help', confidence: 0.9, language: 'en' });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[VOICE TRANSCRIPT]'));
    assert.ok(result.includes('I need help'));
  });

  it('should auto-detect and normalize weather JSON', () => {
    const raw = JSON.stringify({ temperature: 40, humidity: 90, conditions: 'extreme heat', alerts: ['Red alert'] });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[WEATHER ALERT DATA]'));
    assert.ok(result.includes('40'));
    assert.ok(result.includes('Red alert'));
  });

  it('should auto-detect and normalize traffic JSON', () => {
    const raw = JSON.stringify({ incident: 'Pile-up', affectedRoads: ['Highway 1'], hazards: ['Fuel spill'] });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[TRAFFIC INCIDENT REPORT]'));
    assert.ok(result.includes('Pile-up'));
    assert.ok(result.includes('Fuel spill'));
  });

  it('should auto-detect and normalize medical record JSON', () => {
    const raw = JSON.stringify({ chiefComplaint: 'shortness of breath', patientAge: 70, vitals: { pulse: 115 } });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[MEDICAL RECORD]'));
    assert.ok(result.includes('shortness of breath'));
  });

  it('should auto-detect and normalize news JSON', () => {
    const raw = JSON.stringify({ headline: 'Earthquake strikes coast', urgency: 'CRITICAL', affectedArea: 'Coastal Zone' });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[NEWS / ALERT REPORT]'));
    assert.ok(result.includes('Earthquake strikes coast'));
  });

  it('should auto-detect and normalize iot-sensor JSON', () => {
    const raw = JSON.stringify({ deviceId: 'ABC-1', readings: { seismic: 5.8 }, deviceType: 'seismic' });
    const result = normalizeInput(raw);
    assert.ok(result.includes('[IoT SENSOR READING]'));
    assert.ok(result.includes('5.8'));
  });

  it('should respect an explicit format override', () => {
    // Raw text that looks like plain text, but we say it is weather
    const raw = JSON.stringify({ temperature: 35, conditions: 'hot' });
    const result = normalizeInput(raw, 'weather');
    assert.ok(result.includes('[WEATHER ALERT DATA]'));
  });

  it('should normalize medical record with explicit format hint', () => {
    const raw = JSON.stringify({ chiefComplaint: 'Acute abdomen pain', patientAge: 34 });
    const result = normalizeInput(raw, 'medical-record');
    assert.ok(result.includes('[MEDICAL RECORD]'));
    assert.ok(result.includes('Acute abdomen pain'));
  });

  it('should normalize news item with explicit format hint', () => {
    const raw = JSON.stringify({ headline: 'Volcano erupts', urgency: 'CRITICAL', body: 'Ash cloud 40km wide' });
    const result = normalizeInput(raw, 'news');
    assert.ok(result.includes('[NEWS / ALERT REPORT]'));
    assert.ok(result.includes('Volcano erupts'));
  });

  it('should normalize iot-sensor with explicit format hint', () => {
    const raw = JSON.stringify({ deviceId: 'flood-01', readings: { waterLevel: 4.8 } });
    const result = normalizeInput(raw, 'iot-sensor');
    assert.ok(result.includes('[IoT SENSOR READING]'));
    assert.ok(result.includes('flood-01'));
    assert.ok(result.includes('4.8'));
  });

  it('should normalize voice transcript with explicit format hint', () => {
    const raw = JSON.stringify({ transcript: 'Explosion heard at the chemical plant.' });
    const result = normalizeInput(raw, 'voice-transcript');
    assert.ok(result.includes('[VOICE TRANSCRIPT]'));
    assert.ok(result.includes('Explosion heard'));
  });

  it('should normalize traffic with explicit format hint', () => {
    const raw = JSON.stringify({ incident: 'Tanker rollover', casualties: 2, hazards: ['Chemical spill'] });
    const result = normalizeInput(raw, 'traffic');
    assert.ok(result.includes('[TRAFFIC INCIDENT REPORT]'));
    assert.ok(result.includes('Tanker rollover'));
    assert.ok(result.includes('Chemical spill'));
  });

  it('should fall back to raw text if format is given but JSON is invalid', () => {
    const raw = 'not json';
    const result = normalizeInput(raw, 'weather');
    assert.equal(result, raw);
  });

  it('should handle unrecognized JSON gracefully (returns raw text)', () => {
    const raw = JSON.stringify({ unknownField: 'something', otherField: 42 });
    const result = normalizeInput(raw);
    // Should return the raw string (detected as 'text')
    assert.equal(result, raw);
  });
});
