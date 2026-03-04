/** Ray-casting point-in-polygon for a single ring (exterior boundary). */
function pointInRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function metersPerDegreeLon(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function pointToSegmentDistanceMeters(
  lng: number,
  lat: number,
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number
): number {
  const mx = metersPerDegreeLon(lat);
  const my = 110_540;
  const px = lng * mx;
  const py = lat * my;
  const x1 = lng1 * mx;
  const y1 = lat1 * my;
  const x2 = lng2 * mx;
  const y2 = lat2 * my;

  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function distanceToRingMeters(lng: number, lat: number, ring: number[][]): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1];
    const b = ring[i];
    const d = pointToSegmentDistanceMeters(lng, lat, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

/** Returns true if [lng, lat] is inside the polygon (respecting holes). */
function pointInPolygon(lng: number, lat: number, coords: number[][][]): boolean {
  const [exterior, ...holes] = coords;
  if (!pointInRing(lng, lat, exterior)) return false;
  for (const hole of holes) {
    if (pointInRing(lng, lat, hole)) return false; // inside a hole = outside polygon
  }
  return true;
}

/**
 * Finds the first zoning feature that contains the given coordinates.
 * Returns null if the point isn't inside any zone.
 */
export function findZoneAtPoint(
  data: GeoJSON.FeatureCollection,
  lng: number,
  lat: number
): GeoJSON.Feature | null {
  for (const feature of data.features) {
    const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      if (pointInPolygon(lng, lat, geom.coordinates)) return feature;
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        if (pointInPolygon(lng, lat, poly)) return feature;
      }
    }
  }
  return null;
}

/**
 * Finds containing zoning feature; if none is found, falls back to nearest polygon
 * edge within max distance (useful when points are geocoded to street centerlines).
 */
export function findZoneAtPointOrNearest(
  data: GeoJSON.FeatureCollection,
  lng: number,
  lat: number,
  maxDistanceMeters = 30
): GeoJSON.Feature | null {
  const containing = findZoneAtPoint(data, lng, lat);
  if (containing) return containing;

  let best: GeoJSON.Feature | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const feature of data.features) {
    const geom = feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      const d = distanceToRingMeters(lng, lat, geom.coordinates[0]);
      if (d < bestDistance) {
        bestDistance = d;
        best = feature;
      }
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        const d = distanceToRingMeters(lng, lat, poly[0]);
        if (d < bestDistance) {
          bestDistance = d;
          best = feature;
        }
      }
    }
  }

  return bestDistance <= maxDistanceMeters ? best : null;
}

export interface GeocodedAddress {
  lat: number;
  lng: number;
  displayName: string;
}

export interface AddressSuggestion {
  description: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

export async function autocompleteAddress(query: string): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(`/api/google/autocomplete?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error("google autocomplete request failed");
    const data = await res.json();
    const googlePredictions = Array.isArray(data.predictions) ? data.predictions : [];
    if (googlePredictions.length > 0) return googlePredictions;
  } catch {
    // Continue to fallback provider.
  }

  try {
    const fallbackQuery = /champaign|urbana/i.test(q) ? q : `${q}, Champaign, IL`;
    const fallbackUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(fallbackQuery)}` +
      `&format=json&addressdetails=1&limit=6&countrycodes=us`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: { "User-Agent": "ChampaignZoningTool/1.0" },
    });
    if (!fallbackRes.ok) return [];
    const rows = await fallbackRes.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((row: { display_name: string; place_id: string | number }) => ({
      description: row.display_name,
      placeId: `nominatim-${row.place_id}`,
      primaryText: row.display_name.split(",")[0] ?? row.display_name,
      secondaryText: row.display_name,
    }));
  } catch {
    return [];
  }
}

/** Geocodes an address string using Google first, then Nominatim fallback. */
export async function geocodeAddress(
  query: string,
  placeId?: string
): Promise<GeocodedAddress | null> {
  try {
    const params = placeId
      ? `placeId=${encodeURIComponent(placeId)}`
      : `q=${encodeURIComponent(query)}`;
    const googleRes = await fetch(`/api/google/geocode?${params}`);
    if (googleRes.ok) {
      const googleData = await googleRes.json();
      if (googleData?.result) {
        return googleData.result as GeocodedAddress;
      }
    }
  } catch {
    // Fall through to Nominatim fallback.
  }

  /** Fallback: Geocodes an address string using Nominatim, biased toward Champaign IL. */
  // Append city/state if not already present to bias results
  const fullQuery = /champaign|urbana/i.test(query)
    ? query
    : `${query}, Champaign, IL`;

  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(fullQuery)}` +
    `&format=json&limit=1&countrycodes=us` +
    `&viewbox=-88.4,40.0,-88.1,40.25&bounded=0`;

  const res = await fetch(url, {
    headers: { "User-Agent": "ChampaignZoningTool/1.0" },
  });

  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  const results = await res.json();
  if (!results.length) return null;

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}
