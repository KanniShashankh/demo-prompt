/**
 * @module locationEnricher.test
 * @description Unit tests for the location enrichment service.
 *
 * HTTP-calling functions are tested with a mocked global.fetch so they
 * run offline and deterministically in CI/CD and local environments.
 *
 * Coverage:
 *   - haversineDistanceKm: known coordinates, same-point zero distance
 *   - extractLocationCandidate: all regex patterns, no-match returns null
 *   - geocodeLocation: no-key fallback, successful geocoding, API failure, network error
 *   - findNearbyEmergencyServices: no-key fallback, successful response,
 *                                  partial failure (one type errors)
 *   - enrichWithLocationContext: no location found, geocoding fails, full pipeline
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  haversineDistanceKm,
  extractLocationCandidate,
  geocodeLocation,
  findNearbyEmergencyServices,
  enrichWithLocationContext,
  type Coordinates,
} from '../services/locationEnricher';

// ────────────────────────────────────────────────────────────────
// Mock helpers
// ────────────────────────────────────────────────────────────────

function mockJsonResponse(payload: unknown, ok = true): Response {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ok, json: () => Promise.resolve(payload) } as any as Response;
}

let savedFetch: typeof globalThis.fetch;
let savedMapsKey: string | undefined;
let savedGoogleKey: string | undefined;

beforeEach(() => {
  savedFetch   = globalThis.fetch;
  savedMapsKey  = process.env.GOOGLE_MAPS_API_KEY;
  savedGoogleKey = process.env.GOOGLE_API_KEY;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedMapsKey   === undefined) { delete process.env.GOOGLE_MAPS_API_KEY; }
  else { process.env.GOOGLE_MAPS_API_KEY = savedMapsKey; }
  if (savedGoogleKey === undefined) { delete process.env.GOOGLE_API_KEY; }
  else { process.env.GOOGLE_API_KEY = savedGoogleKey; }
});

// ────────────────────────────────────────────────────────────────
// haversineDistanceKm
// ────────────────────────────────────────────────────────────────

describe('haversineDistanceKm', () => {
  it('should return 0 for the same point', () => {
    const coord: Coordinates = { lat: 12.9716, lng: 77.5946 };
    assert.equal(haversineDistanceKm(coord, coord), 0);
  });

  it('should return approximately 1.57 km between two Bengaluru points', () => {
    const a: Coordinates = { lat: 12.9716, lng: 77.5946 };
    const b: Coordinates = { lat: 12.9857, lng: 77.5877 }; // ~1.57 km away
    const dist = haversineDistanceKm(a, b);
    assert.ok(dist > 1 && dist < 2.5, `Expected ~1.5 km, got ${dist}`);
  });

  it('should return approx 5570 km between London and New York', () => {
    const london  : Coordinates = { lat: 51.5074, lng: -0.1278 };
    const newYork : Coordinates = { lat: 40.7128, lng: -74.0060 };
    const dist = haversineDistanceKm(london, newYork);
    // Known distance ≈ 5570 km; allow ±100 km for rounding
    assert.ok(dist > 5400 && dist < 5700, `Expected ~5570 km, got ${dist}`);
  });

  it('should be commutative: dist(A, B) === dist(B, A)', () => {
    const a: Coordinates = { lat: 19.0760, lng: 72.8777 }; // Mumbai
    const b: Coordinates = { lat: 28.7041, lng: 77.1025 }; // Delhi
    const d1 = haversineDistanceKm(a, b);
    const d2 = haversineDistanceKm(b, a);
    assert.ok(Math.abs(d1 - d2) < 0.001, `Expected symmetric distances, got ${d1} vs ${d2}`);
  });
});

// ────────────────────────────────────────────────────────────────
// extractLocationCandidate
// ────────────────────────────────────────────────────────────────

describe('extractLocationCandidate', () => {
  it('should return null for empty text', () => {
    assert.equal(extractLocationCandidate(''), null);
  });

  it('should return null for text with no location mention', () => {
    assert.equal(extractLocationCandidate('There was an accident involving three vehicles'), null);
  });

  it('should extract "in <City>" pattern', () => {
    const result = extractLocationCandidate('Flooding in Chennai Metropolitan Area reported');
    assert.ok(result !== null, 'Should extract a location candidate');
    assert.ok(result!.toLowerCase().includes('chennai'), `Got: ${result}`);
  });

  it('should extract "near <Location>" pattern', () => {
    const result = extractLocationCandidate('Accident near MG Road overpass');
    assert.ok(result !== null);
  });

  it('should extract Indian highway identifiers', () => {
    const result = extractLocationCandidate(
      'Multi-vehicle pile-up on NH-48 near Bengaluru Outer Ring Road',
    );
    assert.ok(result !== null, 'Should extract highway location');
    assert.ok(result!.toUpperCase().includes('NH'), `Got: ${result}`);
  });

  it('should extract "City, Country" pattern', () => {
    const result = extractLocationCandidate('Hospital collapse in Mumbai, India');
    assert.ok(result !== null);
    assert.ok(result!.includes('Mumbai'), `Got: ${result}`);
  });

  it('should extract sector/district patterns', () => {
    const result = extractLocationCandidate('Gas leak in Sector 7, Industrial Area');
    assert.ok(result !== null);
    assert.ok(result!.toLowerCase().includes('sector'));
  });
});

// ────────────────────────────────────────────────────────────────
// geocodeLocation
// ────────────────────────────────────────────────────────────────

describe('geocodeLocation', () => {
  it('should return null when no API key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return mockJsonResponse({}); };

    const result = await geocodeLocation('Mumbai, India');
    assert.equal(result, null);
    assert.equal(fetchCalled, false, 'fetch should not be called without API key');
  });

  it('should return null for empty location text', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return mockJsonResponse({}); };

    const result = await geocodeLocation('');
    assert.equal(result, null);
    assert.equal(fetchCalled, false);
  });

  it('should return a geocoded location from a successful API response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';

    globalThis.fetch = async () => mockJsonResponse({
      status: 'OK',
      results: [{
        formatted_address: 'Chennai, Tamil Nadu, India',
        geometry: { location: { lat: 13.0827, lng: 80.2707 } },
        address_components: [
          { long_name: 'Chennai', types: ['locality'] },
          { long_name: 'India', types: ['country'] },
        ],
      }],
    });

    const result = await geocodeLocation('Chennai');
    assert.ok(result !== null);
    assert.equal(result!.formatted, 'Chennai, Tamil Nadu, India');
    assert.equal(result!.coordinates.lat, 13.0827);
    assert.equal(result!.coordinates.lng, 80.2707);
    assert.equal(result!.country, 'India');
    assert.equal(result!.locality, 'Chennai');
  });

  it('should return null when API status is not OK', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({ status: 'ZERO_RESULTS', results: [] });

    const result = await geocodeLocation('Nonexistent Place XYZ');
    assert.equal(result, null);
  });

  it('should return null on HTTP error response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = async () => mockJsonResponse({}, false);

    const result = await geocodeLocation('Mumbai');
    assert.equal(result, null);
  });

  it('should return null on network error (fetch throws)', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    globalThis.fetch = async () => { throw new Error('Network error'); };

    const result = await geocodeLocation('Delhi');
    assert.equal(result, null);
  });
});

// ────────────────────────────────────────────────────────────────
// findNearbyEmergencyServices
// ────────────────────────────────────────────────────────────────

describe('findNearbyEmergencyServices', () => {
  const coords: Coordinates = { lat: 12.9716, lng: 77.5946 }; // Bengaluru

  it('should return empty array when no API key is configured', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return mockJsonResponse({}); };

    const result = await findNearbyEmergencyServices(coords);
    assert.deepEqual(result, []);
    assert.equal(fetchCalled, false);
  });

  it('should return hospital and police services from successful API responses', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const callQueue = [
      // hospital
      {
        status: 'OK',
        results: [{
          name: 'Apollo Hospital',
          vicinity: '21, Greams Lane, Chennai',
          geometry: { location: { lat: 13.0650, lng: 80.2575 } },
        }],
      },
      // fire_station
      { status: 'ZERO_RESULTS', results: [] },
      // police
      {
        status: 'OK',
        results: [{
          name: 'Bengaluru Central Police',
          vicinity: 'MG Road',
          geometry: { location: { lat: 12.9756, lng: 77.6097 } },
        }],
      },
    ];
    let callIndex = 0;
    globalThis.fetch = async () => mockJsonResponse(callQueue[callIndex++]);

    const result = await findNearbyEmergencyServices(coords);
    assert.equal(result.length, 2);

    const hospital = result.find(s => s.type === 'hospital');
    assert.ok(hospital, 'Should find a hospital');
    assert.equal(hospital!.name, 'Apollo Hospital');
    assert.ok(typeof hospital!.distanceKm === 'number', 'Should have distanceKm');

    const police = result.find(s => s.type === 'police');
    assert.ok(police, 'Should find a police station');
  });

  it('should continue when one service type throws a network error', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    let callCount = 0;

    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) throw new Error('Timeout');
      return mockJsonResponse({ status: 'ZERO_RESULTS', results: [] });
    };

    // Should not throw — should gracefully skip the erroring call
    const result = await findNearbyEmergencyServices(coords);
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });

  it('should return at most 2 results per service type', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    const manyResults = Array.from({ length: 5 }, (_, i) => ({
      name: `Hospital ${i + 1}`,
      vicinity: `Address ${i + 1}`,
      geometry: { location: { lat: 12.97 + i * 0.01, lng: 77.59 } },
    }));

    globalThis.fetch = async () => mockJsonResponse({ status: 'OK', results: manyResults });

    const result = await findNearbyEmergencyServices(coords);
    // 3 types × max 2 per type = 6 max
    assert.ok(result.length <= 6, `Expected at most 6, got ${result.length}`);
    // Each type should have at most 2 entries
    const hospitals = result.filter(s => s.type === 'hospital');
    assert.ok(hospitals.length <= 2);
  });
});

// ────────────────────────────────────────────────────────────────
// enrichWithLocationContext
// ────────────────────────────────────────────────────────────────

describe('enrichWithLocationContext', () => {
  it('should return detected=false for text with no location mention', async () => {
    const result = await enrichWithLocationContext(
      'There was a car crash involving multiple vehicles',
    );
    assert.equal(result.detected, false);
    assert.equal(result.contextText, '');
    assert.deepEqual(result.nearbyServices, []);
  });

  it('should return detected=false when geocoding fails (no API key)', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const result = await enrichWithLocationContext(
      'Flooding in Chennai Metropolitan Area',
    );
    assert.equal(result.detected, false);
  });

  it('should return full enrichment when geocoding and places succeed', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        // geocodeLocation call
        return mockJsonResponse({
          status: 'OK',
          results: [{
            formatted_address: 'Chennai, Tamil Nadu, India',
            geometry: { location: { lat: 13.0827, lng: 80.2707 } },
            address_components: [
              { long_name: 'Chennai', types: ['locality'] },
              { long_name: 'India', types: ['country'] },
            ],
          }],
        });
      }
      // findNearbyEmergencyServices calls (3 calls: hospital, fire, police)
      return mockJsonResponse({
        status: 'OK',
        results: [{
          name: `Service ${callIndex}`,
          vicinity: 'Test Street',
          geometry: { location: { lat: 13.081, lng: 80.265 } },
        }],
      });
    };

    const result = await enrichWithLocationContext(
      'Gas explosion in Chennai, India. Multiple injuries reported.',
    );

    assert.equal(result.detected, true);
    assert.ok(result.location);
    assert.equal(result.location!.country, 'India');
    assert.ok(result.nearbyServices.length > 0);

    // contextText must include header and location
    assert.ok(result.contextText.includes('GEOGRAPHIC CONTEXT'));
    assert.ok(result.contextText.includes('Chennai'));
  });

  it('should include nearby service names in contextText', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    let callIndex = 0;

    globalThis.fetch = async () => {
      callIndex++;
      if (callIndex === 1) {
        return mockJsonResponse({
          status: 'OK',
          results: [{
            formatted_address: 'Mumbai, Maharashtra, India',
            geometry: { location: { lat: 19.0760, lng: 72.8777 } },
            address_components: [
              { long_name: 'Mumbai', types: ['locality'] },
              { long_name: 'India', types: ['country'] },
            ],
          }],
        });
      }
      if (callIndex === 2) {
        return mockJsonResponse({
          status: 'OK',
          results: [{
            name: 'Lilavati Hospital',
            vicinity: 'Bandra West',
            geometry: { location: { lat: 19.0478, lng: 72.8313 } },
          }],
        });
      }
      return mockJsonResponse({ status: 'ZERO_RESULTS', results: [] });
    };

    const result = await enrichWithLocationContext('Building collapse in Mumbai, India');
    assert.ok(result.contextText.includes('Lilavati Hospital'));
    assert.ok(result.contextText.includes('hospital'));
  });
});
