"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Map, { Layer, Marker, Source, MapMouseEvent, MapRef } from "react-map-gl/maplibre";
import type { FilterSpecification, DataDrivenPropertyValueSpecification, ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ZONE_COLOR_MAP,
  ZoneFeatureProperties,
  getZoneDescription,
  getZoneDistrict,
} from "@/lib/zoning";
import { BuildType, BUILD_COLORS } from "@/lib/buildTypes";

const TILE_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CHAMPAIGN_CENTER = { lng: -88.2434, lat: 40.1164 };

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
  selectedId: number | null;
  onSelectFeature: (feature: GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties> | null) => void;
  searchPin: { lat: number; lng: number } | null;
}

export default function ZoningMap({
  data,
  activeCodes,
  activeBuild,
  selectedId,
  onSelectFeature,
  searchPin,
}: ZoningMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
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
  }, []);

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
    [hoveredId, activeBuild]
  );

  const handleMouseLeave = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map) map.getCanvas().style.cursor = "";
    setHoveredId(null);
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ["zoning-fill"] });
      if (features.length > 0) {
        onSelectFeature(features[0] as unknown as GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties>);
      } else {
        onSelectFeature(null);
      }
    },
    [onSelectFeature]
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
        <div className="absolute bottom-4 md:bottom-8 left-3 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-100 px-3 py-2.5">
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
