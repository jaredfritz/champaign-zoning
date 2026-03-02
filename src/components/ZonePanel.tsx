"use client";

import { X } from "lucide-react";
import {
  ZoneFeatureProperties,
  ZONE_DETAILS,
  areaToAcres,
  getZoneDescription,
  getZoneDistrict,
} from "@/lib/zoning";

interface ZonePanelProps {
  feature: GeoJSON.Feature<GeoJSON.Geometry, ZoneFeatureProperties> | null;
  onClose: () => void;
}

export default function ZonePanel({ feature, onClose }: ZonePanelProps) {
  if (!feature) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-gray-400">
        <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-500">Click a zone to see details</p>
      </div>
    );
  }

  const props = feature.properties;
  const district = getZoneDistrict(props.zoning_code);
  const description = getZoneDescription(props.zoning_code);
  const color = district?.color ?? "#d1d5db";
  const area = props["SHAPE.STArea()"];

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-gray-100">
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex-shrink-0 mt-0.5"
            style={{ backgroundColor: color }}
          />
          <div>
            <div className="text-xl font-bold text-gray-900">{props.zoning_code}</div>
            <div className="text-sm text-gray-500">{description}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* District badge */}
      {district && (
        <div className="px-5 pt-4 pb-2">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
            style={{ backgroundColor: `${color}33`, color: "#1b2b3c" }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            {district.label}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="px-5 py-3">
        <div className="bg-gray-50 rounded-xl p-3">
          <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Area</div>
          <div className="text-lg font-semibold text-gray-900">{areaToAcres(area)}</div>
          <div className="text-xs text-gray-400">acres</div>
        </div>
      </div>

      {/* Details */}
      <div className="px-5 py-3 space-y-1">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Details</div>
        <Row label="Zone Code" value={props.zoning_code} />
        <div className="py-1.5 border-b border-gray-50">
          <span className="text-sm text-gray-500">Description</span>
          <div className="text-sm text-gray-800 mt-0.5 leading-relaxed">
            {ZONE_DETAILS[props.zoning_code] || "—"}
          </div>
        </div>
      </div>

      {/* Data Sources */}
      <div className="px-5 py-4 mt-auto border-t border-gray-100">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
          Data Sources
        </div>
        <div className="flex flex-col gap-1.5 text-sm text-blue-600">
          <a
            href="https://gis-cityofchampaign.opendata.arcgis.com/datasets/a24e403a9fa245dbaaaf46f766860c40_15/explore?location=40.113600%2C-88.308850%2C13"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Map data available here.
          </a>
          <a
            href="https://library.municode.com/il/champaign/codes/code_of_ordinances?nodeId=MUCO_CH37ZO"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            City of Champaign zoning ordinances available here.
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value}</span>
    </div>
  );
}
