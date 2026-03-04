"use client";

import { BUILD_TYPES, BuildType } from "@/lib/buildTypes";

interface BuildFilterProps {
  activeBuild: BuildType | null;
  onChange: (build: BuildType | null) => void;
}

function isReady(bt: BuildType): boolean {
  return (
    bt.allowedCodes.length > 0 ||
    (bt.provisionalCodes?.length ?? 0) > 0 ||
    bt.notAllowedCodes.length > 0
  );
}

function BuildOptionRow({
  bt,
  active,
  onClick,
}: {
  bt: BuildType;
  active: boolean;
  onClick: () => void;
}) {
  const ready = isReady(bt);

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 text-left text-xs rounded-md transition-colors ${
        active
          ? "bg-blue-50 text-blue-700"
          : ready
          ? "text-gray-700 hover:bg-gray-50"
          : "text-gray-300 cursor-not-allowed"
      }`}
    >
      <span
        className="w-3.5 h-3.5 rounded-full border flex-shrink-0"
        style={{
          borderColor: active ? "#2563eb" : ready ? "#9ca3af" : "#d1d5db",
          backgroundColor: active ? "#2563eb" : "transparent",
        }}
      />
      <span className="font-medium">{bt.label}</span>
      {!ready && <span className="text-[10px] text-gray-300 ml-auto">soon</span>}
    </button>
  );
}

export default function BuildFilter({ activeBuild, onChange }: BuildFilterProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-2">
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide px-1 pb-1.5">
        Where Can I Build A...
      </div>
      <div className="space-y-0.5">
        {BUILD_TYPES.map((bt) => {
          const active = activeBuild?.id === bt.id;
          return (
            <BuildOptionRow
              key={bt.id}
              bt={bt}
              active={active}
              onClick={() => onChange(active ? null : bt)}
            />
          );
        })}
      </div>
    </div>
  );
}
