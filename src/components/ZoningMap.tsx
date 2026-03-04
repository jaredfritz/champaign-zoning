"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Map, { Layer, Marker, Source, MapMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { FilterSpecification, DataDrivenPropertyValueSpecification, ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ZONE_COLOR_MAP,
  ZoneFeatureProperties,
  ZONE_DETAILS,
  getZoneDescription,
  getZoneDistrict,
} from "@/lib/zoning";
import { BuildType, BUILD_COLORS } from "@/lib/buildTypes";
import { findZoneAtPointOrNearest } from "@/lib/geo";
import { PermitFeatureProperties, SelectedPermit } from "@/lib/permits";

const TILE_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CHAMPAIGN_CENTER = { lng: -88.2434, lat: 40.1164 };
const SF_PERMIT_COLOR = "#0072B2";
const MF_PERMIT_COLOR = "#E69F00";
const LEGEND_RADIUS_1_UNIT_PX = 3;
const LEGEND_RADIUS_100_UNITS_PX = 17;

function getFeatureCollectionBounds(data: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  function visitCoords(coords: unknown): void {
    if (!Array.isArray(coords)) return;
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const lng = coords[0];
      const lat = coords[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const item of coords) visitCoords(item);
  }

  for (const feature of data.features) {
    if (!feature.geometry) continue;
    if (feature.geometry.type === "GeometryCollection") {
      for (const geom of feature.geometry.geometries) {
        if ("coordinates" in geom) visitCoords(geom.coordinates);
      }
    } else if ("coordinates" in feature.geometry) {
      visitCoords(feature.geometry.coordinates);
    }
  }

  if (
    !Number.isFinite(minLng) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLng) ||
    !Number.isFinite(maxLat)
  ) {
    return null;
  }

  return [minLng, minLat, maxLng, maxLat];
}

function applyThoroughfareLabelDraft(map: MapLibreMap) {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const layerDef = layer as {
      id: string;
      layout?: Record<string, unknown>;
      source?: string;
      "source-layer"?: string;
    };
    const hasTextField = Boolean(layerDef.layout?.["text-field"]);
    if (!hasTextField) continue;

    const id = layerDef.id.toLowerCase();
    const sourceLayer = (layerDef["source-layer"] ?? "").toLowerCase();
    const isRoadLabelLayer =
      id.includes("road") ||
      id.includes("street") ||
      id.includes("highway") ||
      sourceLayer.includes("transport") ||
      sourceLayer.includes("road");
    if (!isRoadLabelLayer) continue;

    try {
      // Keep original style and only reveal major-road labels earlier.
      const isMajorRoadNameLayer =
        id.includes("highway") ||
        id.includes("major") ||
        id.includes("primary") ||
        id.includes("trunk") ||
        id.includes("motorway");
      if (!isMajorRoadNameLayer) continue;

      const min = typeof (layer as { minzoom?: unknown }).minzoom === "number"
        ? (layer as { minzoom?: number }).minzoom!
        : 0;
      const max = typeof (layer as { maxzoom?: unknown }).maxzoom === "number"
        ? (layer as { maxzoom?: number }).maxzoom!
        : 24;
      const loweredMin = Math.max(0, min - 2);
      map.setLayerZoomRange(layerDef.id, loweredMin, max);
    } catch {
      // Ignore style-layer mismatches across third-party basemap style versions.
    }
  }
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 30);
  const g = Math.max(0, ((n >> 8) & 0xff) - 30);
  const b = Math.max(0, (n & 0xff) - 30);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Normal mode: color by zone code
function buildFillColorExpr(
  activeCodes: Set<string>
): DataDrivenPropertyValueSpecification<string> {
  const arms: string[] = [];
  for (const [code, color] of Object.entries(ZONE_COLOR_MAP)) {
    if (activeCodes.has(code)) arms.push(code, color);
  }
  if (arms.length === 0) return "rgba(0,0,0,0)";
  return ["match", ["get", "zoning_code"], ...arms, "#e5e7eb"] as unknown as DataDrivenPropertyValueSpecification<string>;
}

function buildHoverColorExpr(
  activeCodes: Set<string>
): DataDrivenPropertyValueSpecification<string> {
  const arms: string[] = [];
  for (const [code, color] of Object.entries(ZONE_COLOR_MAP)) {
    if (activeCodes.has(code)) arms.push(code, darken(color));
  }
  if (arms.length === 0) return "rgba(0,0,0,0)";
  return ["match", ["get", "zoning_code"], ...arms, "#9ca3af"] as unknown as DataDrivenPropertyValueSpecification<string>;
}

function buildVisibilityFilter(activeCodes: Set<string>): FilterSpecification {
  const codes = Array.from(activeCodes);
  if (codes.length === 0) {
    return ["==", ["get", "OBJECTID"], -1] as unknown as FilterSpecification;
  }
  return ["in", ["get", "zoning_code"], ["literal", codes]] as unknown as FilterSpecification;
}

// Build mode: blue for by-right, yellow for provisional, orange for not-allowed, gray for others
function buildModeFillColor(bt: BuildType): DataDrivenPropertyValueSpecification<string> {
  const arms: unknown[] = [];
  if (bt.allowedCodes.length > 0) arms.push(bt.allowedCodes, BUILD_COLORS.allowed);
  if (bt.provisionalCodes && bt.provisionalCodes.length > 0) arms.push(bt.provisionalCodes, BUILD_COLORS.provisional);
  if (bt.notAllowedCodes.length > 0) arms.push(bt.notAllowedCodes, BUILD_COLORS.notAllowed);
  return ["match", ["get", "zoning_code"], ...arms, "#d1d5db"] as unknown as DataDrivenPropertyValueSpecification<string>;
}

function buildModeHoverColor(bt: BuildType): DataDrivenPropertyValueSpecification<string> {
  const arms: unknown[] = [];
  if (bt.allowedCodes.length > 0) arms.push(bt.allowedCodes, darken(BUILD_COLORS.allowed));
  if (bt.provisionalCodes && bt.provisionalCodes.length > 0) arms.push(bt.provisionalCodes, darken(BUILD_COLORS.provisional));
  if (bt.notAllowedCodes.length > 0) arms.push(bt.notAllowedCodes, darken(BUILD_COLORS.notAllowed));
  return ["match", ["get", "zoning_code"], ...arms, "#9ca3af"] as unknown as DataDrivenPropertyValueSpecification<string>;
}

interface ZoningMapProps {
  data: GeoJSON.FeatureCollection;
  activeCodes: Set<string>;
  activeBuild: BuildType | null;
  permitsData: GeoJSON.FeatureCollection;
  showPermits: boolean;
  permitRenderMode: "points" | "heatmap";
  permitYearRange: { from: number; to: number } | null;
  selectedId: number | null;
  onSelectFeature: (feature: GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties> | null) => void;
  onSelectPermit: (permit: SelectedPermit | null) => void;
  searchPin: { lat: number; lng: number } | null;
}

export default function ZoningMap({
  data,
  activeCodes,
  activeBuild,
  permitsData,
  showPermits,
  permitRenderMode,
  permitYearRange,
  selectedId,
  onSelectFeature,
  onSelectPermit,
  searchPin,
}: ZoningMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [hoveredPermitId, setHoveredPermitId] = useState<number | null>(null);
  const [mobileLegendOpen, setMobileLegendOpen] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    code: string;
    description: string;
    districtLabel: string;
    buildStatus: "allowed" | "provisional" | "notAllowed" | null;
  } | null>(null);

  // Register hachure sprite on map load
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const size = 12;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><line x1="0" y1="0" x2="${size}" y2="${size}" stroke="rgba(0,0,0,0.38)" stroke-width="1.5"/></svg>`;
    const img = new Image(size, size);
    img.onload = () => {
      if (!map.hasImage("hachure")) {
        map.addImage("hachure", img, { pixelRatio: 2 });
      }
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    // Draft map readability tuning: stronger major thoroughfare labels.
    applyThoroughfareLabelDraft(map);

    const bounds = getFeatureCollectionBounds(data);
    if (bounds) {
      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        {
          padding: 36,
          duration: 0,
          maxZoom: 15,
        }
      );
    }
  }, [data]);

  // Fly to searched address when pin changes
  useEffect(() => {
    if (!searchPin) return;
    mapRef.current?.getMap()?.flyTo({
      center: [searchPin.lng, searchPin.lat],
      zoom: 15,
      duration: 1400,
    });
  }, [searchPin]);

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      if (showPermits && permitRenderMode === "points") {
        const permitFeatures = map.queryRenderedFeatures(e.point, { layers: ["residential-permits-circles"] });
        if (permitFeatures.length > 0) {
          map.getCanvas().style.cursor = "pointer";
          const pid = typeof permitFeatures[0].id === "number" ? permitFeatures[0].id : null;
          if (pid !== hoveredPermitId) setHoveredPermitId(pid);
          setTooltip(null);
          return;
        }
      }
      if (hoveredPermitId !== null) setHoveredPermitId(null);
      const features = map.queryRenderedFeatures(e.point, { layers: ["zoning-fill"] });
      if (features.length > 0) {
        const f = features[0];
        const id = f.properties?.OBJECTID as number;
        const code = f.properties?.zoning_code as string;
        map.getCanvas().style.cursor = "pointer";
        if (id !== hoveredId) setHoveredId(id);

        let buildStatus: "allowed" | "provisional" | "notAllowed" | null = null;
        if (activeBuild) {
          if (activeBuild.allowedCodes.includes(code)) buildStatus = "allowed";
          else if (activeBuild.provisionalCodes?.includes(code)) buildStatus = "provisional";
          else if (activeBuild.notAllowedCodes.includes(code)) buildStatus = "notAllowed";
        }

        setTooltip({
          x: e.point.x,
          y: e.point.y,
          code,
          description: getZoneDescription(code),
          districtLabel: getZoneDistrict(code)?.shortLabel ?? "",
          buildStatus,
        });
      } else {
        map.getCanvas().style.cursor = "";
        setHoveredId(null);
        setTooltip(null);
      }
    },
    [hoveredId, hoveredPermitId, activeBuild, showPermits, permitRenderMode]
  );

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "";
    setHoveredId(null);
    setHoveredPermitId(null);
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      if (showPermits && permitRenderMode === "points") {
        const permitFeatures = map.queryRenderedFeatures(e.point, { layers: ["residential-permits-circles"] });
        if (permitFeatures.length > 0) {
          const p = permitFeatures[0].properties as unknown as PermitFeatureProperties;
          const lngLat = (permitFeatures[0].geometry as GeoJSON.Point | undefined)?.coordinates;
          let zoneCode: string | null = null;
          let zoneCodeLabel = "—";
          let zoneDescription = "—";
          if (lngLat && lngLat.length >= 2) {
            const containingZone = findZoneAtPointOrNearest(data, lngLat[0], lngLat[1]) as GeoJSON.Feature<
              GeoJSON.Geometry,
              ZoneFeatureProperties
            > | null;
            zoneCode = containingZone?.properties?.zoning_code ?? null;
            if (zoneCode) {
              const fullName = getZoneDescription(zoneCode);
              zoneCodeLabel = `${zoneCode} — ${fullName}`;
              zoneDescription = ZONE_DETAILS[zoneCode] ?? fullName;
            }
          }
          onSelectPermit({
            permitNo: p.permit_no ?? "—",
            year: typeof p.year === "number" ? p.year : null,
            address: p.address ?? "—",
            buildingType: p.building_type ?? "—",
            units: typeof p.units === "number" ? p.units : null,
            zoneCode,
            zoneCodeLabel,
            zoneDescription,
          });
          return;
        }
      }
      const features = map.queryRenderedFeatures(e.point, { layers: ["zoning-fill"] });
      if (features.length > 0) {
        onSelectPermit(null);
        onSelectFeature(features[0] as unknown as GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties>);
      } else {
        onSelectPermit(null);
        onSelectFeature(null);
      }
    },
    [data, onSelectFeature, onSelectPermit, showPermits, permitRenderMode]
  );

  const inBuildMode = activeBuild !== null;

  // Normal mode expressions
  const fillColor = buildFillColorExpr(activeCodes);
  const hoverColor = buildHoverColorExpr(activeCodes);
  const visibilityFilter = buildVisibilityFilter(activeCodes);

  // Build mode expressions
  const buildFillColor = inBuildMode ? buildModeFillColor(activeBuild!) : null;
  const buildHoverColor = inBuildMode ? buildModeHoverColor(activeBuild!) : null;
  const showAllFilter = ["has", "zoning_code"] as unknown as FilterSpecification;
  const hachureCodes = inBuildMode
    ? Array.from(new Set([...(activeBuild!.notAllowedCodes ?? []), ...(activeBuild!.hatchedCodes ?? [])]))
    : [];
  const hachureFilter = inBuildMode && hachureCodes.length > 0
    ? (["in", ["get", "zoning_code"], ["literal", hachureCodes]] as unknown as FilterSpecification)
    : (["==", ["get", "OBJECTID"], -1] as unknown as FilterSpecification);
  const provisionalLegendLabel =
    inBuildMode && activeBuild!.id === "fourplex"
      ? "Provisional; ground-floor restrictions"
      : "Provisional; restrictions apply";
  const showProvisionalLegend = inBuildMode && (activeBuild!.provisionalCodes?.length ?? 0) > 0;
  const showAnyLegend = inBuildMode || showPermits;

  useEffect(() => {
    if (!showAnyLegend) setMobileLegendOpen(false);
  }, [showAnyLegend]);

  // Active fill color (normal vs build)
  const activeFillBase = inBuildMode ? buildFillColor! : fillColor;
  const activeHoverBase = inBuildMode ? buildHoverColor! : hoverColor;
  const activeFilter = inBuildMode ? showAllFilter : visibilityFilter;

  const fillColorExpr: DataDrivenPropertyValueSpecification<string> = [
    "case",
    ["==", ["get", "OBJECTID"], hoveredId ?? -1], activeHoverBase as unknown as string,
    activeFillBase as unknown as string,
  ] as unknown as DataDrivenPropertyValueSpecification<string>;

  const opacityExpr: ExpressionSpecification = [
    "case",
    ["==", ["get", "OBJECTID"], selectedId ?? -1], 0.9,
    ["==", ["get", "OBJECTID"], hoveredId ?? -1], 0.85,
    inBuildMode ? 0.7 : 0.55,
  ];

  const lineColorExpr: ExpressionSpecification = [
    "case",
    ["==", ["get", "OBJECTID"], selectedId ?? -1], "#1b2b3c",
    ["==", ["get", "OBJECTID"], hoveredId ?? -1], "#374151",
    "#6b7280",
  ];

  const lineWidthExpr: ExpressionSpecification = [
    "case",
    ["==", ["get", "OBJECTID"], selectedId ?? -1], 2.5,
    ["==", ["get", "OBJECTID"], hoveredId ?? -1], 1.5,
    0.5,
  ];
  const permitYearFilter = permitYearRange
    ? ([
        "all",
        [">=", ["to-number", ["get", "year"], 0], permitYearRange.from],
        ["<=", ["to-number", ["get", "year"], 0], permitYearRange.to],
      ] as unknown as FilterSpecification)
    : undefined;

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: CHAMPAIGN_CENTER.lng,
          latitude: CHAMPAIGN_CENTER.lat,
          zoom: 12,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={TILE_STYLE}
        onLoad={handleMapLoad}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <Source id="zoning" type="geojson" data={data}>
          <Layer
            id="zoning-fill"
            type="fill"
            filter={activeFilter}
            paint={{
              "fill-color": fillColorExpr,
              "fill-opacity": opacityExpr,
            }}
          />
          {/* Hachure overlay on not-allowed zones in build mode */}
          <Layer
            id="zoning-hachure"
            type="fill"
            filter={hachureFilter}
            paint={{
              "fill-pattern": "hachure",
              "fill-opacity": 0.9,
            } as object}
          />
          <Layer
            id="zoning-outline"
            type="line"
            filter={activeFilter}
            paint={{
              "line-color": lineColorExpr,
              "line-width": lineWidthExpr,
              "line-opacity": 0.7,
            }}
          />
        </Source>
        {showPermits && (
          <Source id="residential-permits" type="geojson" data={permitsData} generateId>
            {permitRenderMode === "points" && (
              <Layer
                id="residential-permits-circles"
                type="circle"
                filter={permitYearFilter}
                paint={{
                  "circle-color": [
                    "match",
                    ["get", "building_type"],
                    "SF",
                    SF_PERMIT_COLOR,
                    "MF",
                    MF_PERMIT_COLOR,
                    "#6b7280",
                  ],
                  "circle-radius": [
                    "case",
                    ["==", ["id"], hoveredPermitId ?? -1],
                    [
                      "interpolate",
                      ["linear"],
                      ["to-number", ["get", "units"], 1],
                      1,
                      5,
                      2,
                      6,
                      4,
                      8,
                      8,
                      10.5,
                      20,
                      14,
                      50,
                      17,
                      150,
                      21,
                      322,
                      24,
                    ],
                    [
                      "interpolate",
                      ["linear"],
                      ["to-number", ["get", "units"], 1],
                      1,
                      3.5,
                      2,
                      4.5,
                      4,
                      6.5,
                      8,
                      9,
                      20,
                      12.5,
                      50,
                      15.5,
                      150,
                      19.5,
                      322,
                      22.5,
                    ],
                  ],
                  "circle-stroke-color": "#ffffff",
                  "circle-stroke-width": [
                    "case",
                    ["==", ["id"], hoveredPermitId ?? -1],
                    2,
                    1,
                  ],
                  "circle-opacity": 0.78,
                }}
              />
            )}
            {permitRenderMode === "heatmap" && (
              <Layer
                id="residential-permits-heatmap"
                type="heatmap"
                filter={permitYearFilter}
                paint={{
                  "heatmap-weight": [
                    "interpolate",
                    ["linear"],
                    ["to-number", ["get", "units"], 1],
                    1,
                    0.2,
                    10,
                    0.5,
                    50,
                    0.8,
                    150,
                    1,
                  ],
                  "heatmap-intensity": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    0.5,
                    14,
                    0.9,
                  ],
                  "heatmap-color": [
                    "interpolate",
                    ["linear"],
                    ["heatmap-density"],
                    0,
                    "rgba(99,102,241,0)",
                    0.2,
                    "rgba(56,189,248,0.65)",
                    0.45,
                    "rgba(34,197,94,0.75)",
                    0.7,
                    "rgba(250,204,21,0.8)",
                    1,
                    "rgba(239,68,68,0.9)",
                  ],
                  "heatmap-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    18,
                    14,
                    28,
                    17,
                    38,
                  ],
                  "heatmap-opacity": 0.85,
                }}
              />
            )}
          </Source>
        )}

        {/* Address search pin */}
        {searchPin && (
          <Marker longitude={searchPin.lng} latitude={searchPin.lat} anchor="bottom">
            <div className="flex flex-col items-center">
              <div className="w-5 h-5 rounded-full bg-red-500 border-2 border-white shadow-lg" />
              <div className="w-0.5 h-3 bg-red-500" />
            </div>
          </Marker>
        )}

      </Map>

      {/* Build mode legend */}
      {inBuildMode && (
        <div
          className="hidden md:block absolute left-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 px-3 py-2.5"
          style={{ bottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="text-xs font-semibold text-gray-700 mb-2">{activeBuild!.label}</div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0"
                style={{ backgroundColor: BUILD_COLORS.allowed }}
              />
              <span>Allowed by right</span>
            </div>
            {showProvisionalLegend && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div
                  className="w-4 h-4 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: BUILD_COLORS.provisional }}
                />
                <span>{provisionalLegendLabel}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <div
                className="w-4 h-4 rounded-sm flex-shrink-0 relative overflow-hidden"
                style={{ backgroundColor: BUILD_COLORS.notAllowed }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "repeating-linear-gradient(-45deg, rgba(0,0,0,0.38), rgba(0,0,0,0.38) 1px, transparent 1px, transparent 5px)",
                  }}
                />
              </div>
              <span>Not allowed</span>
            </div>
          </div>
        </div>
      )}
      {showPermits && (
        <div
          className="hidden md:block absolute right-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 px-3 py-2.5"
          style={{ bottom: "calc(2rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="text-xs font-semibold text-gray-700 mb-2">Residential Permits 2014-2024</div>
          {permitRenderMode === "points" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: SF_PERMIT_COLOR }} />
                <span>Single-family (SF)</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: MF_PERMIT_COLOR }} />
                <span>Multifamily (MF)</span>
              </div>
              <div className="pt-1 mt-0.5 border-t border-gray-100 text-[11px] text-gray-500">
                <div className="mb-1">Circle size scales by units per permit</div>
                <div className="flex items-end gap-3">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="rounded-full bg-gray-500/70 border border-white"
                      style={{
                        width: `${LEGEND_RADIUS_1_UNIT_PX * 2}px`,
                        height: `${LEGEND_RADIUS_1_UNIT_PX * 2}px`,
                      }}
                    />
                    <span>1 unit</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="rounded-full bg-gray-500/70 border border-white"
                      style={{
                        width: `${LEGEND_RADIUS_100_UNITS_PX * 2}px`,
                        height: `${LEGEND_RADIUS_100_UNITS_PX * 2}px`,
                      }}
                    />
                    <span>100 units</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[11px] text-gray-500">Heat intensity weighted by unit count</div>
              <div
                className="h-2.5 w-44 rounded"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(56,189,248,0.65) 0%, rgba(34,197,94,0.75) 35%, rgba(250,204,21,0.8) 65%, rgba(239,68,68,0.9) 100%)",
                }}
              />
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>Lower units</span>
                <span>Higher units</span>
              </div>
            </div>
          )}
        </div>
      )}
      {showAnyLegend && (
        <div
          className="md:hidden absolute left-3 z-10"
          style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <button
            onClick={() => setMobileLegendOpen((v) => !v)}
            className="min-h-11 px-3 py-2 rounded-full border border-gray-200 bg-white/95 backdrop-blur-sm text-xs font-medium text-gray-700 shadow-lg"
          >
            {mobileLegendOpen ? "Hide legend" : "Legend"}
          </button>
          {mobileLegendOpen && (
            <div className="mt-2 w-[min(88vw,22rem)] max-h-[45dvh] overflow-auto bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 px-3 py-2.5">
              {inBuildMode && (
                <div>
                  <div className="text-xs font-semibold text-gray-700 mb-2">{activeBuild!.label}</div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <div
                        className="w-4 h-4 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: BUILD_COLORS.allowed }}
                      />
                      <span>Allowed by right</span>
                    </div>
                    {showProvisionalLegend && (
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <div
                          className="w-4 h-4 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: BUILD_COLORS.provisional }}
                        />
                        <span>{provisionalLegendLabel}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                      <div
                        className="w-4 h-4 rounded-sm flex-shrink-0 relative overflow-hidden"
                        style={{ backgroundColor: BUILD_COLORS.notAllowed }}
                      >
                        <div
                          className="absolute inset-0"
                          style={{
                            background:
                              "repeating-linear-gradient(-45deg, rgba(0,0,0,0.38), rgba(0,0,0,0.38) 1px, transparent 1px, transparent 5px)",
                          }}
                        />
                      </div>
                      <span>Not allowed</span>
                    </div>
                  </div>
                </div>
              )}
              {showPermits && (
                <div className={inBuildMode ? "pt-2 mt-2 border-t border-gray-100" : ""}>
                  <div className="text-xs font-semibold text-gray-700 mb-2">Residential Permits 2014-2024</div>
                  {permitRenderMode === "points" ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: SF_PERMIT_COLOR }} />
                        <span>Single-family (SF)</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: MF_PERMIT_COLOR }} />
                        <span>Multifamily (MF)</span>
                      </div>
                      <div className="pt-1 mt-0.5 border-t border-gray-100 text-[11px] text-gray-500">
                        <div className="mb-1">Circle size scales by units per permit</div>
                        <div className="flex items-end gap-3">
                          <div className="flex items-center gap-1.5">
                            <div
                              className="rounded-full bg-gray-500/70 border border-white"
                              style={{
                                width: `${LEGEND_RADIUS_1_UNIT_PX * 2}px`,
                                height: `${LEGEND_RADIUS_1_UNIT_PX * 2}px`,
                              }}
                            />
                            <span>1 unit</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div
                              className="rounded-full bg-gray-500/70 border border-white"
                              style={{
                                width: `${LEGEND_RADIUS_100_UNITS_PX * 2}px`,
                                height: `${LEGEND_RADIUS_100_UNITS_PX * 2}px`,
                              }}
                            />
                            <span>100 units</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-[11px] text-gray-500">Heat intensity weighted by unit count</div>
                      <div
                        className="h-2.5 w-40 rounded"
                        style={{
                          background:
                            "linear-gradient(90deg, rgba(56,189,248,0.65) 0%, rgba(34,197,94,0.75) 35%, rgba(250,204,21,0.8) 65%, rgba(239,68,68,0.9) 100%)",
                        }}
                      />
                      <div className="flex items-center justify-between text-[11px] text-gray-500">
                        <span>Lower units</span>
                        <span>Higher units</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tooltip && (
        <div
          className="absolute z-10 pointer-events-none bg-white/95 backdrop-blur-sm shadow-lg rounded-lg px-3 py-2 text-sm border border-gray-100"
          style={{ left: tooltip.x + 12, top: tooltip.y - 48 }}
        >
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-gray-900">{tooltip.code}</span>
            {tooltip.districtLabel && (
              <span className="text-xs text-gray-400">{tooltip.districtLabel}</span>
            )}
            {tooltip.buildStatus === "allowed" && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">Allowed</span>
            )}
            {tooltip.buildStatus === "provisional" && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-800">Provisional</span>
            )}
            {tooltip.buildStatus === "notAllowed" && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">Not Allowed</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{tooltip.description}</div>
        </div>
      )}
    </div>
  );
}
