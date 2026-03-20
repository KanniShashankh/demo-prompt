/**
 * @module locationEnricher
 * @description Google Maps Platform integration for LifeBridge.
 *
 * Extracts location mentions from emergency inputs, geocodes them to
 * coordinates, and finds nearby emergency services. This allows LifeBridge
 * to produce hyper-local action plans:
 *
 *   "Nearest hospital: Apollo Hospital, 1.8 km north-east (12.9716°N, 77.5946°E)"
 *
 * instead of generic "go to the nearest hospital".
 *
 * Uses Google Maps Geocoding API and Places API Nearby Search via REST.
 * Falls back gracefully if GOOGLE_MAPS_API_KEY is not configured.
 *
 * Environment variables:
 *   - GOOGLE_MAPS_API_KEY  — dedicated Maps Platform key (recommended)
 *   - GOOGLE_API_KEY       — fallback (must have Maps APIs enabled)
 */

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodedLocation {
  formatted: string;
  coordinates: Coordinates;
  country: string;
  locality?: string;
}

export interface NearbyService {
  name: string;
  type: 'hospital' | 'fire_station' | 'police';
  address: string;
  distanceKm?: number;
  coordinates: Coordinates;
}

export interface LocationEnrichment {
  detected: boolean;
  locationCandidate?: string;
  location?: GeocodedLocation;
  nearbyServices: NearbyService[];
  contextText: string;
}

// ────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────

const GEOCODING_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const PLACES_URL    = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';

/** Search radius for nearby emergency services in metres. */
const NEARBY_RADIUS_METERS = 5000;

/** Max number of results per service type. */
const MAX_RESULTS_PER_TYPE = 2;

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function getMapsApiKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    undefined
  );
}

/**
 * Compute the great-circle distance between two coordinates (Haversine formula).
 *
 * @returns Distance in kilometres
 */
export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1R = (a.lat * Math.PI) / 180;
  const lat2R = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1R) * Math.cos(lat2R) * Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.asin(Math.sqrt(h));
}

// ────────────────────────────────────────────────────────────────
// Location extraction (no HTTP — deterministic and fully testable)
// ────────────────────────────────────────────────────────────────

/**
 * Patterns for extracting location candidates from unstructured text.
 *
 * Ordered by specificity — more specific patterns (highway markers) come first.
 */
const LOCATION_PATTERNS: RegExp[] = [
  // Indian highway markers: "NH-48 near Chennai"
  /\b(?:NH|SH|MDR|ODR)\s*[-–]?\s*\d+\b[^,;.!?]{0,30}/i,

  // Explicit mention: "in Bengaluru", "in Sector 14"
  /\bin\s+([A-Z][a-zA-Z,\s]{3,50})(?:,\s*[A-Z][a-z]+)?\b/,

  // "near/at <Location>"
  /\b(?:near|at|beside|outside|opposite)\s+([A-Z][a-zA-Z\s]{3,40})/,

  // "on <Road/Highway Name>"
  /\bon\s+([A-Z][a-zA-Z0-9\s-]{3,40}(?:road|highway|street|avenue|blvd|lane|rd|hwy|st|ave))/i,

  // City + country pattern: "Chennai, India"
  /([A-Z][a-z]{2,20},\s*(?:India|USA|UK|Australia|Canada|Germany|France|Brazil|Japan|China|Korea))/,

  // Sector/District patterns: "Sector 14", "District 7"
  /\b(?:sector|district|block|zone|ward)\s*\d+\b/i,
];

/**
 * Extract the best location candidate string from unstructured emergency text.
 *
 * Returns `null` if no confident location mention is found.
 *
 * @param text - Raw or sanitized input text
 * @returns A location string suitable for geocoding, or null
 */
export function extractLocationCandidate(text: string): string | null {
  if (!text) return null;

  for (const pattern of LOCATION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      // Prefer capture group 1 if present, otherwise the full match
      const candidate = (match[1] ?? match[0]).trim().replace(/\s+/g, ' ');
      if (candidate.length >= 3) {
        return candidate;
      }
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────
// Google Maps API calls
// ────────────────────────────────────────────────────────────────

/**
 * Geocode a location string to coordinates using Google Maps Geocoding API.
 *
 * Returns `null` when:
 *   - No API key is configured
 *   - The API returns a non-OK status
 *   - Any network or parsing error occurs
 *
 * @param locationText - Human-readable location (e.g. "NH-48, Bengaluru")
 * @returns Geocoded location with coordinates and metadata
 */
export async function geocodeLocation(locationText: string): Promise<GeocodedLocation | null> {
  const apiKey = getMapsApiKey();
  if (!apiKey || !locationText) return null;

  try {
    const url = new URL(GEOCODING_URL);
    url.searchParams.set('address', locationText);
    url.searchParams.set('key', apiKey);

    const response = await globalThis.fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json() as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: { location: Coordinates };
        address_components: Array<{ long_name: string; types: string[] }>;
      }>;
    };

    if (data.status !== 'OK' || !data.results.length) return null;

    const result = data.results[0];
    const country =
      result.address_components.find(c => c.types.includes('country'))?.long_name ?? '';
    const locality =
      result.address_components.find(
        c => c.types.includes('locality') || c.types.includes('administrative_area_level_2'),
      )?.long_name;

    return {
      formatted: result.formatted_address,
      coordinates: result.geometry.location,
      country,
      locality,
    };
  } catch {
    return null;
  }
}

/**
 * Find nearby emergency services for given coordinates using Places API.
 *
 * @param coords        - Centre coordinates for the search
 * @param radiusMeters  - Search radius in metres (default: 5000)
 * @returns Array of nearby services, sorted by type (hospital, fire, police)
 */
export async function findNearbyEmergencyServices(
  coords: Coordinates,
  radiusMeters = NEARBY_RADIUS_METERS,
): Promise<NearbyService[]> {
  const apiKey = getMapsApiKey();
  if (!apiKey) return [];

  const serviceTypes: Array<'hospital' | 'fire_station' | 'police'> = [
    'hospital',
    'fire_station',
    'police',
  ];

  const services: NearbyService[] = [];

  for (const type of serviceTypes) {
    try {
      const url = new URL(PLACES_URL);
      url.searchParams.set('location', `${coords.lat},${coords.lng}`);
      url.searchParams.set('radius', String(radiusMeters));
      url.searchParams.set('type', type);
      url.searchParams.set('key', apiKey);

      const response = await globalThis.fetch(url.toString());
      if (!response.ok) continue;

      const data = await response.json() as {
        status: string;
        results: Array<{
          name: string;
          vicinity: string;
          geometry: { location: Coordinates };
        }>;
      };

      if (data.status !== 'OK') continue;

      for (const place of data.results.slice(0, MAX_RESULTS_PER_TYPE)) {
        services.push({
          name: place.name,
          type,
          address: place.vicinity,
          distanceKm: parseFloat(
            haversineDistanceKm(coords, place.geometry.location).toFixed(1),
          ),
          coordinates: place.geometry.location,
        });
      }
    } catch {
      // Skip this service type on error
      continue;
    }
  }

  return services;
}

// ────────────────────────────────────────────────────────────────
// Orchestration
// ────────────────────────────────────────────────────────────────

/**
 * Full location enrichment pipeline:
 *   1. Extract a location candidate from text
 *   2. Geocode it to coordinates
 *   3. Find nearby emergency services
 *   4. Return a context text block to prepend to the Gemini prompt
 *
 * Returns `{ detected: false }` when no location can be extracted or geocoded.
 *
 * @param text - Sanitized user input
 * @returns Location enrichment result including prompt context text
 */
export async function enrichWithLocationContext(text: string): Promise<LocationEnrichment> {
  const noResult: LocationEnrichment = {
    detected: false,
    nearbyServices: [],
    contextText: '',
  };

  const locationCandidate = extractLocationCandidate(text);
  if (!locationCandidate) return noResult;

  const location = await geocodeLocation(locationCandidate);
  if (!location) {
    return { ...noResult, locationCandidate };
  }

  const nearbyServices = await findNearbyEmergencyServices(location.coordinates);

  const lines: string[] = [
    '',
    '[GEOGRAPHIC CONTEXT — Auto-enriched by Google Maps]',
    `Location: ${location.formatted}`,
  ];

  if (location.country) {
    lines[2] += ` (${location.country})`;
  }

  if (nearbyServices.length > 0) {
    lines.push('Nearest emergency services:');
    for (const svc of nearbyServices) {
      const typeLabel = svc.type.replace('_', ' ');
      const dist = svc.distanceKm !== undefined ? ` — ${svc.distanceKm} km away` : '';
      lines.push(`  • ${svc.name} [${typeLabel}] — ${svc.address}${dist}`);
    }
  } else {
    lines.push('(Emergency service locations unavailable for this area)');
  }

  lines.push('');

  return {
    detected: true,
    locationCandidate,
    location,
    nearbyServices,
    contextText: lines.join('\n'),
  };
}
