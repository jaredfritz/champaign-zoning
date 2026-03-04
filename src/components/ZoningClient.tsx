"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Building2, Layers3, MapPinned, Menu, Search, Sparkles, X } from "lucide-react";
import { ALL_ZONE_CODES, ZoneFeatureProperties } from "@/lib/zoning";
import { GeocodedAddress, findZoneAtPoint } from "@/lib/geo";
import { BUILD_TYPES, BuildType } from "@/lib/buildTypes";
import { SelectedPermit } from "@/lib/permits";
import FilterBar from "./FilterBar";
import ZonePanel from "./ZonePanel";
import AddressSearch from "./AddressSearch";
import BuildFilter from "./BuildFilter";

const ZoningMap = dynamic(() => import("./ZoningMap"), { ssr: false });

interface ZoningClientProps {
  data: GeoJSON.FeatureCollection;
  permitsData: GeoJSON.FeatureCollection;
}

type MapMode = "zoning" | "permits" | "build" | "advanced";

type ModeDef = {
  id: MapMode;
  label: string;
  hint: string;
  icon: "zoning" | "permits" | "build" | "advanced";
};

const MAP_MODES: ModeDef[] = [
  {
    id: "zoning",
    label: "Champaign Zoning Districts",
    hint: "Browse district boundaries and zoning codes.",
    icon: "zoning",
  },
  {
    id: "permits",
    label: "Residential Permit Map",
    hint: "View new residential permits from 2014-2024.",
    icon: "permits",
  },
  {
    id: "build",
    label: "Where Can I Build A...",
    hint: "Find where housing and cafe uses are allowed.",
    icon: "build",
  },
  {
    id: "advanced",
    label: "Advanced Overlay",
    hint: "Combine layers and filters in one view.",
    icon: "advanced",
  },
];

function modeFromParam(value: string | null): MapMode {
  if (value === "permits" || value === "build" || value === "advanced") {
    return value;
  }
  return "zoning";
}

function ModeIcon({ icon }: { icon: ModeDef["icon"] }) {
  if (icon === "zoning") return <MapPinned className="w-4 h-4 text-blue-700" />;
  if (icon === "permits") return <Building2 className="w-4 h-4 text-emerald-700" />;
  if (icon === "build") return <Sparkles className="w-4 h-4 text-amber-700" />;
  return <Layers3 className="w-4 h-4 text-violet-700" />;
}

function permitViewFromParam(value: string | null): "points" | "heatmap" {
  return value === "heatmap" ? "heatmap" : "points";
}

export default function ZoningClient({ data, permitsData }: ZoningClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [controlsOpen, setControlsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeCodes, setActiveCodes] = useState<Set<string>>(
    new Set(ALL_ZONE_CODES)
  );
  const [selectedFeature, setSelectedFeature] = useState<GeoJSON.Feature<
    GeoJSON.Geometry,
    ZoneFeatureProperties
  > | null>(null);
  const [searchPin, setSearchPin] = useState<{ lat: number; lng: number } | null>(null);
  const [activeBuild, setActiveBuild] = useState<BuildType | null>(null);
  const [showPermits, setShowPermits] = useState(false);
  const [selectedPermit, setSelectedPermit] = useState<SelectedPermit | null>(null);
  const permitYears = useMemo(() => {
    const years = new Set<number>();
    for (const feature of permitsData.features) {
      const y = (feature.properties as { year?: unknown } | null | undefined)?.year;
      if (typeof y === "number" && Number.isFinite(y)) years.add(y);
    }
    return Array.from(years).sort((a, b) => a - b);
  }, [permitsData]);
  const [permitYearRange, setPermitYearRange] = useState<{ from: number; to: number } | null>(null);

  const initialMode = useMemo(
    () => modeFromParam(searchParams.get("mode")),
    [searchParams]
  );
  const initialPermitRenderMode = useMemo(
    () => permitViewFromParam(searchParams.get("permitView")),
    [searchParams]
  );
  const [mapMode, setMapMode] = useState<MapMode>(initialMode);
  const [permitRenderMode, setPermitRenderMode] = useState<"points" | "heatmap">(initialPermitRenderMode);

  useEffect(() => {
    if (window.innerWidth >= 768) setControlsOpen(true);
  }, []);

  useEffect(() => {
    activateMode(initialMode, { syncUrl: false });
    setPermitRenderMode(initialPermitRenderMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (permitYears.length === 0) return;
    const min = permitYears[0];
    const max = permitYears[permitYears.length - 1];
    setPermitYearRange((prev) => {
      if (!prev) return { from: min, to: max };
      const nextFrom = Math.max(min, Math.min(prev.from, max));
      const nextTo = Math.max(nextFrom, Math.min(prev.to, max));
      if (nextFrom === prev.from && nextTo === prev.to) return prev;
      return { from: nextFrom, to: nextTo };
    });
  }, [permitYears]);

  useEffect(() => {
    const nextMode = modeFromParam(searchParams.get("mode"));
    const nextPermitView = permitViewFromParam(searchParams.get("permitView"));
    if (nextMode !== mapMode) {
      activateMode(nextMode, { syncUrl: false });
    }
    if (nextPermitView !== permitRenderMode) {
      setPermitRenderMode(nextPermitView);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const hasPanelSelection = Boolean(selectedFeature || selectedPermit);
  const modeDef = MAP_MODES.find((m) => m.id === mapMode) ?? MAP_MODES[0];

  function syncModeParam(nextMode: MapMode, nextPermitView?: "points" | "heatmap") {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMode === "zoning") params.delete("mode");
    else params.set("mode", nextMode);
    const permitView = nextPermitView ?? permitRenderMode;
    if (nextMode === "permits") {
      if (permitView === "heatmap") params.set("permitView", "heatmap");
      else params.delete("permitView");
    } else {
      params.delete("permitView");
    }
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  function activateMode(nextMode: MapMode, options?: { syncUrl?: boolean }) {
    const syncUrl = options?.syncUrl ?? true;
    setMapMode(nextMode);
    setSelectedFeature(null);
    setSelectedPermit(null);

    if (nextMode === "zoning") {
      setShowPermits(false);
      setActiveBuild(null);
      setActiveCodes(new Set(ALL_ZONE_CODES));
    } else if (nextMode === "permits") {
      setShowPermits(true);
      setActiveBuild(null);
      setActiveCodes(new Set());
    } else if (nextMode === "build") {
      setShowPermits(false);
      setActiveCodes(new Set(ALL_ZONE_CODES));
      if (!activeBuild) {
        const defaultBuild = BUILD_TYPES.find((bt) => bt.id === "fourplex") ?? BUILD_TYPES[0] ?? null;
        setActiveBuild(defaultBuild);
      }
    } else {
      setActiveCodes((prev) => (prev.size === 0 ? new Set(ALL_ZONE_CODES) : prev));
    }

    if (syncUrl) syncModeParam(nextMode);
  }

  function resetCurrentFilters() {
    if (mapMode === "zoning") {
      setActiveCodes(new Set(ALL_ZONE_CODES));
    } else if (mapMode === "permits") {
      setShowPermits(true);
      setActiveCodes(new Set());
      setActiveBuild(null);
      setPermitRenderMode("points");
      if (permitYears.length > 0) {
        setPermitYearRange({ from: permitYears[0], to: permitYears[permitYears.length - 1] });
      }
    } else if (mapMode === "build") {
      const defaultBuild = BUILD_TYPES.find((bt) => bt.id === "fourplex") ?? BUILD_TYPES[0] ?? null;
      setActiveBuild(defaultBuild);
      setShowPermits(false);
      setActiveCodes(new Set(ALL_ZONE_CODES));
    } else {
      setShowPermits(false);
      setActiveBuild(null);
      setActiveCodes(new Set(ALL_ZONE_CODES));
    }
    setSelectedFeature(null);
    setSelectedPermit(null);
    setSearchPin(null);
  }

  function handleSearchResult(result: GeocodedAddress) {
    setSearchPin({ lat: result.lat, lng: result.lng });
    const zone = findZoneAtPoint(data, result.lng, result.lat);
    setSelectedPermit(null);
    setSelectedFeature(
      zone as GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties> | null
    );
    setSearchOpen(false);
  }

  function handleSearchClear() {
    setSearchPin(null);
    setSelectedFeature(null);
    setSelectedPermit(null);
  }

  function handlePermitRenderModeChange(next: "points" | "heatmap") {
    setPermitRenderMode(next);
    if (mapMode === "permits") {
      syncModeParam(mapMode, next);
    }
  }

  const showZoningFilterBar = mapMode === "zoning" || mapMode === "advanced";
  const showBuildFilter = mapMode === "build" || mapMode === "advanced";
  const showPermitsToggle = mapMode === "advanced";

  return (
    <div className="flex flex-col h-[100dvh] bg-gray-50">
      <header
        className="bg-white border-b border-gray-100 shadow-sm z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="h-14 px-4 md:px-5 flex items-center justify-between">
          <button
            onClick={() => setControlsOpen(true)}
            className="w-10 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 inline-flex items-center justify-center"
            aria-label="Open controls"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="min-w-0 text-center px-2">
            <div className="text-sm font-semibold text-gray-900 leading-tight">Champaign Zoning</div>
            <div className="text-[11px] text-gray-500 truncate">{modeDef.label}</div>
          </div>

          <button
            onClick={() => setSearchOpen(true)}
            className="w-10 h-10 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 inline-flex items-center justify-center"
            aria-label="Open search"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </header>

      {controlsOpen && (
        <>
          <button
            className="md:hidden fixed inset-0 z-30 bg-black/30"
            onClick={() => setControlsOpen(false)}
            aria-label="Close controls"
          />

          <aside
            className="hidden md:block fixed left-4 top-20 z-40 w-[24rem] max-h-[calc(100dvh-6rem)] overflow-y-auto overflow-x-visible bg-white border border-gray-200 shadow-2xl rounded-2xl"
            style={{
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <div className="h-full overflow-y-auto p-3 space-y-3">
              <section className="rounded-xl border border-gray-200 bg-white">
                <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 rounded-t-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Map Mode</div>
                      <div className="text-xs text-gray-500">{modeDef.label}</div>
                    </div>
                    <button
                      onClick={() => setControlsOpen(false)}
                      className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 inline-flex items-center justify-center"
                      aria-label="Close controls"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  {MAP_MODES.map((mode) => {
                    const active = mapMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => activateMode(mode.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                          active
                            ? "border-blue-200 bg-blue-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ModeIcon icon={mode.icon} />
                          <div className={`text-sm font-medium ${active ? "text-blue-700" : "text-gray-800"}`}>
                            {mode.label}
                          </div>
                        </div>
                        <div className={`text-xs mt-0.5 ${active ? "text-blue-600/80" : "text-gray-500"}`}>
                          {mode.hint}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Filters</div>
                <div className="space-y-2">
                  {showPermitsToggle && (
                    <button
                      onClick={() => setShowPermits((v) => !v)}
                      className={`min-h-10 px-3 rounded-full text-xs font-medium border transition-colors ${
                        showPermits
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800"
                      }`}
                    >
                      Residential Permits
                    </button>
                  )}
                  {(showPermits || mapMode === "permits") && (
                    <div className="rounded-lg border border-gray-200 bg-white p-2.5">
                      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                        Permit View
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          onClick={() => handlePermitRenderModeChange("points")}
                          className={`h-8 px-2 rounded border text-xs transition-colors ${
                            permitRenderMode === "points"
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          Individual
                        </button>
                        <button
                          onClick={() => handlePermitRenderModeChange("heatmap")}
                          className={`h-8 px-2 rounded border text-xs transition-colors ${
                            permitRenderMode === "heatmap"
                              ? "bg-gray-900 text-white border-gray-900"
                              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          Heatmap
                        </button>
                      </div>
                    </div>
                  )}
                  {(showPermits || mapMode === "permits") && permitYearRange && permitYears.length > 0 && (
                    <div className="rounded-lg border border-gray-200 bg-white p-2.5">
                      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                        Permit Years
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
                        <select
                          value={permitYearRange.from}
                          onChange={(e) => {
                            const from = Number(e.target.value);
                            setPermitYearRange({
                              from,
                              to: Math.max(from, permitYearRange.to),
                            });
                          }}
                          className="h-8 px-2 rounded border border-gray-300 text-xs bg-white text-gray-700"
                        >
                          {permitYears
                            .filter((y) => y <= permitYearRange.to)
                            .map((y) => (
                              <option key={`desk-from-${y}`} value={y}>
                                {y}
                              </option>
                            ))}
                        </select>
                        <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
                        <select
                          value={permitYearRange.to}
                          onChange={(e) => {
                            const to = Number(e.target.value);
                            setPermitYearRange({
                              from: Math.min(permitYearRange.from, to),
                              to,
                            });
                          }}
                          className="h-8 px-2 rounded border border-gray-300 text-xs bg-white text-gray-700"
                        >
                          {permitYears
                            .filter((y) => y >= permitYearRange.from)
                            .map((y) => (
                              <option key={`desk-to-${y}`} value={y}>
                                {y}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  )}
                  {showBuildFilter && <BuildFilter activeBuild={activeBuild} onChange={setActiveBuild} />}
                  {showZoningFilterBar && (
                    <FilterBar
                      activeCodes={activeCodes}
                      onChange={setActiveCodes}
                      disabled={mapMode === "advanced" && activeBuild !== null}
                    />
                  )}
                  {!showPermitsToggle && !showBuildFilter && !showZoningFilterBar && !(showPermits || mapMode === "permits") && (
                    <div className="text-xs text-gray-500">No additional filters in this mode.</div>
                  )}
                </div>

                <div className="pt-3 mt-3 border-t border-gray-100">
                  <button
                    onClick={resetCurrentFilters}
                    className="text-xs text-gray-600 hover:text-gray-900 hover:underline"
                  >
                    Reset current view
                  </button>
                </div>
              </section>
            </div>
          </aside>

          <aside
            className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-100 shadow-2xl rounded-t-2xl"
            style={{
              maxHeight: "78dvh",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <ControlsContent
              mapMode={mapMode}
              modeDef={modeDef}
              showPermits={showPermits}
              onTogglePermits={() => setShowPermits((v) => !v)}
              activeBuild={activeBuild}
              onChangeBuild={setActiveBuild}
              activeCodes={activeCodes}
              onChangeCodes={setActiveCodes}
              onSelectMode={activateMode}
              onReset={resetCurrentFilters}
              onClose={() => setControlsOpen(false)}
              disableZoningFilter={mapMode === "advanced" && activeBuild !== null}
              showPermitsToggle={showPermitsToggle}
              showBuildFilter={showBuildFilter}
              showZoningFilterBar={showZoningFilterBar}
              permitYears={permitYears}
              permitYearRange={permitYearRange}
              onChangePermitYearRange={setPermitYearRange}
              permitRenderMode={permitRenderMode}
              onChangePermitRenderMode={handlePermitRenderModeChange}
            />
          </aside>
        </>
      )}

      {searchOpen && (
        <>
          <button
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
          />
          <aside className="fixed z-40 top-16 right-4 left-4 md:left-auto md:w-[22rem] bg-white border border-gray-200 rounded-2xl shadow-2xl p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Search Address</div>
              <button
                onClick={() => setSearchOpen(false)}
                className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 inline-flex items-center justify-center"
                aria-label="Close search panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <AddressSearch onResult={handleSearchResult} onClear={handleSearchClear} />
          </aside>
        </>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 relative">
          <ZoningMap
            data={data}
            activeCodes={activeCodes}
            activeBuild={activeBuild}
            permitsData={permitsData}
            showPermits={showPermits}
            permitRenderMode={permitRenderMode}
            permitYearRange={permitYearRange}
            selectedId={selectedFeature?.properties?.OBJECTID ?? null}
            onSelectFeature={(f) => {
              setSelectedPermit(null);
              setSelectedFeature(f);
            }}
            onSelectPermit={(p) => {
              setSelectedFeature(null);
              setSelectedPermit(p);
            }}
            searchPin={searchPin}
          />
        </div>

        <aside
          className="hidden md:block bg-white border-l border-gray-100 shadow-sm flex-shrink-0 overflow-hidden transition-all duration-200"
          style={{ width: hasPanelSelection ? "20rem" : 0 }}
        >
          <ZonePanel
            feature={selectedFeature}
            permit={selectedPermit}
            activeBuild={activeBuild}
            onClose={() => {
              setSelectedFeature(null);
              setSelectedPermit(null);
            }}
          />
        </aside>
      </div>

      {hasPanelSelection && (
        <>
          <button
            aria-label="Close details panel"
            className="md:hidden fixed inset-0 z-30 bg-black/30"
            onClick={() => {
              setSelectedFeature(null);
              setSelectedPermit(null);
            }}
          />
          <aside
            className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-100 shadow-2xl rounded-t-2xl overflow-hidden"
            style={{
              height: "min(66dvh, 34rem)",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            <ZonePanel
              feature={selectedFeature}
              permit={selectedPermit}
              activeBuild={activeBuild}
              onClose={() => {
                setSelectedFeature(null);
                setSelectedPermit(null);
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}

interface ControlsContentProps {
  mapMode: MapMode;
  modeDef: ModeDef;
  showPermits: boolean;
  onTogglePermits: () => void;
  activeBuild: BuildType | null;
  onChangeBuild: (build: BuildType | null) => void;
  activeCodes: Set<string>;
  onChangeCodes: (codes: Set<string>) => void;
  onSelectMode: (mode: MapMode) => void;
  onReset: () => void;
  onClose: () => void;
  disableZoningFilter: boolean;
  showPermitsToggle: boolean;
  showBuildFilter: boolean;
  showZoningFilterBar: boolean;
  permitYears: number[];
  permitYearRange: { from: number; to: number } | null;
  onChangePermitYearRange: (range: { from: number; to: number }) => void;
  permitRenderMode: "points" | "heatmap";
  onChangePermitRenderMode: (mode: "points" | "heatmap") => void;
}

function ControlsContent({
  mapMode,
  modeDef,
  showPermits,
  onTogglePermits,
  activeBuild,
  onChangeBuild,
  activeCodes,
  onChangeCodes,
  onSelectMode,
  onReset,
  onClose,
  disableZoningFilter,
  showPermitsToggle,
  showBuildFilter,
  showZoningFilterBar,
  permitYears,
  permitYearRange,
  onChangePermitYearRange,
  permitRenderMode,
  onChangePermitRenderMode,
}: ControlsContentProps) {
  return (
    <div className="max-h-[inherit] overflow-y-auto overflow-x-visible">
      <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">Controls</div>
            <div className="text-xs text-gray-500">{modeDef.label}</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 inline-flex items-center justify-center"
            aria-label="Close controls"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <section>
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Map Mode</div>
          <div className="space-y-2">
            {MAP_MODES.map((mode) => {
              const active = mapMode === mode.id;
              return (
                <button
                  key={mode.id}
                  onClick={() => onSelectMode(mode.id)}
                  className={`w-full text-left rounded-xl border px-3 py-2.5 transition-colors ${
                    active ? "border-blue-200 bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ModeIcon icon={mode.icon} />
                    <div className={`text-sm font-medium ${active ? "text-blue-700" : "text-gray-800"}`}>
                      {mode.label}
                    </div>
                  </div>
                  <div className={`text-xs mt-0.5 ${active ? "text-blue-600/80" : "text-gray-500"}`}>
                    {mode.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Current Mode Filters</div>
          <div className="space-y-2">
            {showPermitsToggle && (
              <button
                onClick={onTogglePermits}
                className={`min-h-10 px-3 rounded-full text-xs font-medium border transition-colors ${
                  showPermits
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800"
                }`}
              >
                Residential Permits
              </button>
            )}
            {(showPermits || mapMode === "permits") && (
              <div className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  Permit View
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => onChangePermitRenderMode("points")}
                    className={`h-8 px-2 rounded border text-xs transition-colors ${
                      permitRenderMode === "points"
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    onClick={() => onChangePermitRenderMode("heatmap")}
                    className={`h-8 px-2 rounded border text-xs transition-colors ${
                      permitRenderMode === "heatmap"
                        ? "bg-gray-900 text-white border-gray-900"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    Heatmap
                  </button>
                </div>
              </div>
            )}
            {(showPermits || mapMode === "permits") && permitYearRange && permitYears.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-2.5">
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">
                  Permit Years
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 whitespace-nowrap">From</label>
                  <select
                    value={permitYearRange.from}
                    onChange={(e) => {
                      const from = Number(e.target.value);
                      onChangePermitYearRange({
                        from,
                        to: Math.max(from, permitYearRange.to),
                      });
                    }}
                    className="h-8 px-2 rounded border border-gray-300 text-xs bg-white text-gray-700"
                  >
                    {permitYears
                      .filter((y) => y <= permitYearRange.to)
                      .map((y) => (
                        <option key={`mobile-from-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                  </select>
                  <label className="text-xs text-gray-500 whitespace-nowrap">To</label>
                  <select
                    value={permitYearRange.to}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      onChangePermitYearRange({
                        from: Math.min(permitYearRange.from, to),
                        to,
                      });
                    }}
                    className="h-8 px-2 rounded border border-gray-300 text-xs bg-white text-gray-700"
                  >
                    {permitYears
                      .filter((y) => y >= permitYearRange.from)
                      .map((y) => (
                        <option key={`mobile-to-${y}`} value={y}>
                          {y}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            )}
            {showBuildFilter && <BuildFilter activeBuild={activeBuild} onChange={onChangeBuild} />}
            {showZoningFilterBar && (
              <FilterBar
                activeCodes={activeCodes}
                onChange={onChangeCodes}
                disabled={disableZoningFilter}
              />
            )}
            {!showPermitsToggle && !showBuildFilter && !showZoningFilterBar && !(showPermits || mapMode === "permits") && (
              <div className="text-xs text-gray-500">No additional filters in this mode.</div>
            )}
          </div>
        </section>

        <section className="pt-1 border-t border-gray-100">
          <button
            onClick={onReset}
            className="text-xs text-gray-600 hover:text-gray-900 hover:underline"
          >
            Reset current view
          </button>
        </section>
      </div>
    </div>
  );
}
