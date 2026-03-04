"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  ALL_ZONE_CODES,
  DISTRICTS,
  SelectionState,
  ZoneDistrict,
  ZoneSubgroup,
  districtSelectionState,
  subgroupSelectionState,
  toggleCode,
  toggleDistrict,
  toggleSubgroup,
} from "@/lib/zoning";

interface FilterBarProps {
  activeCodes: Set<string>;
  onChange: (codes: Set<string>) => void;
  disabled?: boolean;
}

function ColorCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
  color,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  ariaLabel: string;
  color: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={onChange}
      aria-label={ariaLabel}
      className="h-4 w-4 rounded-[3px] border transition-colors focus:outline-none focus:ring-1 focus:ring-gray-300"
      style={{
        borderColor: color,
        backgroundColor: checked ? color : indeterminate ? `${color}66` : "transparent",
      }}
    />
  );
}

function stateToChecked(state: SelectionState): { checked: boolean; indeterminate: boolean } {
  return {
    checked: state === "all",
    indeterminate: state === "partial",
  };
}

function CodeRow({
  code,
  description,
  color,
  active,
  onToggle,
}: {
  code: string;
  description: string;
  color: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex items-center gap-2.5 py-1.5 text-xs text-gray-700 cursor-pointer select-none">
      <ColorCheckbox
        checked={active}
        onChange={onToggle}
        ariaLabel={`Toggle ${code}`}
        color={color}
      />
      <span className="font-medium">{code}</span>
      <span className="text-gray-500 truncate" title={description}>{description}</span>
    </label>
  );
}

function SubgroupBlock({
  districtId,
  subgroup,
  activeCodes,
  districtColor,
  onChange,
}: {
  districtId: string;
  subgroup: ZoneSubgroup;
  activeCodes: Set<string>;
  districtColor: string;
  onChange: (codes: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = subgroupSelectionState(subgroup, activeCodes);
  const { checked, indeterminate } = stateToChecked(state);

  return (
    <div className="border-l border-gray-200 pl-3 ml-1">
      <div className="flex items-center gap-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
          aria-label={`Toggle ${subgroup.label}`}
        >
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>

        <label className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer select-none min-w-0">
          <ColorCheckbox
            checked={checked}
            indeterminate={indeterminate}
            onChange={() => onChange(toggleSubgroup(subgroup, activeCodes))}
            ariaLabel={`Toggle subgroup ${subgroup.label}`}
            color={districtColor}
          />
          <span className="font-medium truncate" title={subgroup.description}>{subgroup.label}</span>
        </label>
      </div>

      {expanded && (
        <div className="pl-8 pb-1">
          {subgroup.codes.map(({ code, description }) => (
            <CodeRow
              key={`${districtId}-${subgroup.id}-${code}`}
              code={code}
              description={description}
              color={districtColor}
              active={activeCodes.has(code)}
              onToggle={() => onChange(toggleCode(code, activeCodes))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DistrictBlock({
  district,
  activeCodes,
  onChange,
}: {
  district: ZoneDistrict;
  activeCodes: Set<string>;
  onChange: (codes: Set<string>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const state = districtSelectionState(district, activeCodes);
  const { checked, indeterminate } = stateToChecked(state);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
          aria-label={`Toggle ${district.label}`}
        >
          <ChevronDown
            className="w-3.5 h-3.5 transition-transform"
            style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>

        <label className="flex items-center gap-2 text-xs text-gray-800 cursor-pointer select-none min-w-0">
          <ColorCheckbox
            checked={checked}
            indeterminate={indeterminate}
            onChange={() => onChange(toggleDistrict(district, activeCodes))}
            ariaLabel={`Toggle district ${district.label}`}
            color={district.color}
          />
          <span className="font-medium truncate">{district.shortLabel}</span>
          <span className="text-gray-500 truncate">{district.label}</span>
        </label>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-1">
          {district.subgroups.map((subgroup) => (
            <SubgroupBlock
              key={`${district.id}-${subgroup.id}`}
              districtId={district.id}
              subgroup={subgroup}
              activeCodes={activeCodes}
              districtColor={district.color}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilterBar({ activeCodes, onChange, disabled }: FilterBarProps) {
  const allActive = useMemo(() => activeCodes.size === ALL_ZONE_CODES.length, [activeCodes]);

  return (
    <div className={`space-y-2 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(new Set(ALL_ZONE_CODES))}
          className={`h-8 px-2.5 rounded border text-xs transition-colors ${
            allActive
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          Select all
        </button>
        <button
          onClick={() => onChange(new Set())}
          className="h-8 px-2.5 rounded border text-xs text-gray-700 border-gray-300 bg-white hover:bg-gray-50 transition-colors"
        >
          Clear all
        </button>
      </div>

      <div className="space-y-2">
        {DISTRICTS.map((district) => (
          <DistrictBlock
            key={district.id}
            district={district}
            activeCodes={activeCodes}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}
