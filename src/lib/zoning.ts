// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZoneCode {
  code: string;
  description: string;
}

export interface ZoneSubgroup {
  id: string;
  label: string;       // e.g. "SF", "MF", "CB"
  description: string; // e.g. "Single-Family Districts"
  codes: ZoneCode[];
}

export interface ZoneDistrict {
  id: string;
  label: string;       // e.g. "Residential Districts"
  shortLabel: string;  // e.g. "Residential"
  color: string;
  description?: string;
  subgroups: ZoneSubgroup[];
}

export interface ZoneFeatureProperties {
  GlobalID: string;
  OBJECTID: number;
  zoning_code: string;
  zoning_description: string;
  county_code: string | null;
  savoy_code: string | null;
  urbana_code: string | null;
  Links: string | null;
  created_user: string;
  created_date: number;
  last_edited_user: string;
  last_edited_date: number;
  "SHAPE.STArea()": number;
  "SHAPE.STLength()": number;
}

// ─── District Hierarchy ───────────────────────────────────────────────────────

export const DISTRICTS: ZoneDistrict[] = [
  {
    id: "residential",
    label: "Residential Districts",
    shortLabel: "Residential",
    color: "#93c5fd",
    description: "",
    subgroups: [
      {
        id: "sf",
        label: "SF",
        description: "Single-Family Districts",
        codes: [
          { code: "SF1", description: "Single-Family District" },
          { code: "SF2", description: "Single- and Two-Family District" },
        ],
      },
      {
        id: "mf",
        label: "MF",
        description: "Multifamily Districts",
        codes: [
          { code: "MF1", description: "Multifamily Low-Density District" },
          { code: "MF2", description: "Multifamily Medium-Density District" },
          { code: "MF3", description: "Multifamily High-Density District" },
          { code: "MFUniv", description: "Multifamily University District" },
          { code: "MHC", description: "Manufactured Home Community" },
        ],
      },
    ],
  },
  {
    id: "in-town",
    label: "In-Town (IT) Districts",
    shortLabel: "In-Town",
    color: "#c4b5fd",
    description: "",
    subgroups: [
      {
        id: "it-sf",
        label: "IT-SF",
        description: "In-Town Single-Family Districts",
        codes: [
          { code: "IT-SF1", description: "In-Town Single-Family District" },
          { code: "IT-SF2", description: "In-Town Single- and Two-Family District" },
        ],
      },
      {
        id: "it-mr",
        label: "IT-MR",
        description: "In-Town Mixed-Residential Districts",
        codes: [
          { code: "IT-MR1", description: "In-Town Mixed Residential-1 District" },
          { code: "IT-MR2", description: "In-Town Mixed Residential-2 District" },
        ],
      },
      {
        id: "it-mx",
        label: "IT-MX",
        description: "In-Town Mixed-Use District",
        codes: [
          { code: "IT-MX", description: "In-Town Mixed Use District" },
        ],
      },
      {
        id: "it-nc",
        label: "IT-NC",
        description: "In-Town Neighborhood Conservation District",
        codes: [
          { code: "IT-NC", description: "In-Town Neighborhood Conservation District" },
        ],
      },
    ],
  },
  {
    id: "commercial",
    label: "Commercial Districts",
    shortLabel: "Commercial",
    color: "#fcd34d",
    description: "",
    subgroups: [
      {
        id: "cb",
        label: "CB",
        description: "Central Business Districts",
        codes: [
          { code: "CB1", description: "Central Business Urban Fringe District" },
          { code: "CB2", description: "Central Business Downtown District" },
          { code: "CB3", description: "Central Business Campustown District" },
        ],
      },
      {
        id: "co",
        label: "CO",
        description: "Commercial Office District",
        codes: [{ code: "CO", description: "Commercial Office District" }],
      },
      {
        id: "cn",
        label: "CN",
        description: "Commercial Neighborhood District",
        codes: [{ code: "CN", description: "Commercial Neighborhood District" }],
      },
      {
        id: "cg",
        label: "CG",
        description: "Commercial General District",
        codes: [{ code: "CG", description: "Commercial General District" }],
      },
      {
        id: "ci",
        label: "CI",
        description: "Commercial Industrial District",
        codes: [{ code: "CI", description: "Commercial Industrial District" }],
      },
    ],
  },
  {
    id: "industrial",
    label: "Industrial & Interstate Districts",
    shortLabel: "Industrial",
    color: "#fb923c",
    description: "",
    subgroups: [
      {
        id: "i",
        label: "I",
        description: "Industrial Districts",
        codes: [
          { code: "I1", description: "Light Industrial District" },
          { code: "I2", description: "Heavy Industrial District" },
        ],
      },
      {
        id: "iop",
        label: "IOP",
        description: "Interstate Office Park District",
        codes: [{ code: "IOP", description: "Interstate Office Park District" }],
      },
      {
        id: "ibp",
        label: "IBP",
        description: "Interstate Business Park District",
        codes: [{ code: "IBP", description: "Interstate Business Park District" }],
      },
    ],
  },
];

// ─── Derived lookups ──────────────────────────────────────────────────────────

/** Flat list of all zone codes across all districts */
export const ALL_ZONE_CODES: string[] = DISTRICTS.flatMap((d) =>
  d.subgroups.flatMap((sg) => sg.codes.map((c) => c.code))
);

/** Maps each zone code to its district color */
export const ZONE_COLOR_MAP: Record<string, string> = {};
for (const district of DISTRICTS) {
  for (const sg of district.subgroups) {
    for (const { code } of sg.codes) {
      ZONE_COLOR_MAP[code] = district.color;
    }
  }
}

// Fine-tune SF/MF shades around the base residential blue (#93c5fd).
const SF_LIGHT = "#b5d8fe";
const MF_DARK = "#6eaefb";

for (const code of ["SF1", "SF2"]) {
  ZONE_COLOR_MAP[code] = SF_LIGHT;
}
for (const code of ["MF1", "MF2", "MF3", "MFUniv", "MHC"]) {
  ZONE_COLOR_MAP[code] = MF_DARK;
}

// Fine-tune CB shades — slightly darker than the base commercial yellow (#fcd34d).
const CB_DARK = "#fbbf24";

for (const code of ["CB1", "CB2", "CB3"]) {
  ZONE_COLOR_MAP[code] = CB_DARK;
}

/** Maps each zone code to its full description */
export const ZONE_DESCRIPTION_MAP: Record<string, string> = {};
for (const district of DISTRICTS) {
  for (const sg of district.subgroups) {
    for (const { code, description } of sg.codes) {
      ZONE_DESCRIPTION_MAP[code] = description;
    }
  }
}

/** Maps each zone code to its district */
export const ZONE_DISTRICT_MAP: Record<string, ZoneDistrict> = {};
for (const district of DISTRICTS) {
  for (const sg of district.subgroups) {
    for (const { code } of sg.codes) {
      ZONE_DISTRICT_MAP[code] = district;
    }
  }
}

export function getZoneDescription(code: string): string {
  return ZONE_DESCRIPTION_MAP[code] ?? code;
}

export function getZoneDistrict(code: string): ZoneDistrict | undefined {
  return ZONE_DISTRICT_MAP[code];
}

// ─── Zone detail descriptions ─────────────────────────────────────────────────

/** Paragraph-format descriptions shown in the ZonePanel sidebar */
export const ZONE_DETAILS: Record<string, string> = {
  // Residential
  SF1: "This district mandates detached single-family dwellings, artificially restricting housing supply by prohibiting multi-unit development by right.",
  SF2: "While allowing duplexes, this district still imposes a low-density ceiling by restricting common lot-line dwellings to a maximum of two units.",
  MF1: "This district provides for low-rise, low-density apartment buildings, typically two to three stories in height.",
  MF2: "This district is intended for compact development that serves as a transition between major travel corridors or commercial areas and single-family neighborhoods.",
  MF3: "This district allows for a high-density mix of multifamily housing and offices, with limited provision for neighborhood-serving retail.",
  MFUniv: "This district is designed to support high-density student housing and diverse transportation choices near the University of Illinois campus.",
  MHC: "This district provides for unified manufactured housing developments on leasable pads, often serving as a residential transition zone.",
  // In-Town
  "IT-SF1": "This district prioritizes the preservation of existing single-family structures, generally restricting new density to conversions of older homes.",
  "IT-SF2": "This district supports traditional neighborhood patterns but caps residential conversions at a maximum of three units regardless of building size.",
  "IT-MR1": "This district offers a range of housing types from single-family to small-scale multifamily near Downtown.",
  "IT-MR2": "This district provides for a variety of housing types, allowing for larger-scale multifamily structures than the IT-MR1 district.",
  "IT-MX": "This district focuses on a mix of residential and office uses west of Downtown to provide a transition of intensity to adjacent neighborhoods.",
  // Commercial
  CO: "This district is intended for freestanding office buildings and office parks, providing a low-intensity transition between residential and industrial areas.",
  CN: "This district facilitates convenience shopping and personal services designed to meet the daily needs of surrounding residential neighborhoods.",
  CG: "This high-intensity district accommodates a wide range of regional retail and services but limits new residential development to the second story or higher.",
  CB1: "This district promotes a healthy urban built environment by supporting medium-intensity mixed-use development and removing mandatory on-site parking requirements.",
  CB2: "As the city's most vibrant zone, this district supports high-density growth and a strong public realm without the burden of mandatory parking minimums.",
  CB3: "This pedestrian-oriented district creates a high-quality public space by prioritizing walking and transit over automobile-oriented development.",
  CI: "This district provides for a mix of commercial and light industrial uses, often in redevelopment areas surrounding Downtown.",
  // Industrial
  IBP: "This district is intended for large-scale corporate headquarters or office campuses requiring high visibility and interstate access.",
  I1: "This district accommodates light industrial activities such as wholesale, distribution, and assembly that minimize off-site impacts.",
  I2: "This district is reserved for intense industrial operations that may produce significant off-site impacts or handle hazardous materials.",
};

// ─── Selection helpers ────────────────────────────────────────────────────────

export type SelectionState = "all" | "partial" | "none";

export function districtSelectionState(
  district: ZoneDistrict,
  activeCodes: Set<string>
): SelectionState {
  const codes = district.subgroups.flatMap((sg) => sg.codes.map((c) => c.code));
  const activeCount = codes.filter((c) => activeCodes.has(c)).length;
  if (activeCount === 0) return "none";
  if (activeCount === codes.length) return "all";
  return "partial";
}

export function subgroupSelectionState(
  subgroup: ZoneSubgroup,
  activeCodes: Set<string>
): SelectionState {
  const codes = subgroup.codes.map((c) => c.code);
  const activeCount = codes.filter((c) => activeCodes.has(c)).length;
  if (activeCount === 0) return "none";
  if (activeCount === codes.length) return "all";
  return "partial";
}

export function toggleDistrict(
  district: ZoneDistrict,
  activeCodes: Set<string>
): Set<string> {
  const codes = district.subgroups.flatMap((sg) => sg.codes.map((c) => c.code));
  const state = districtSelectionState(district, activeCodes);
  const next = new Set(activeCodes);
  if (state === "all") {
    codes.forEach((c) => next.delete(c));
  } else {
    codes.forEach((c) => next.add(c));
  }
  return next;
}

export function toggleSubgroup(
  subgroup: ZoneSubgroup,
  activeCodes: Set<string>
): Set<string> {
  const codes = subgroup.codes.map((c) => c.code);
  const state = subgroupSelectionState(subgroup, activeCodes);
  const next = new Set(activeCodes);
  if (state === "all") {
    codes.forEach((c) => next.delete(c));
  } else {
    codes.forEach((c) => next.add(c));
  }
  return next;
}

export function toggleCode(code: string, activeCodes: Set<string>): Set<string> {
  const next = new Set(activeCodes);
  if (next.has(code)) {
    next.delete(code);
  } else {
    next.add(code);
  }
  return next;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Converts SHAPE.STArea() (square feet in IL state plane) to acres */
export function areaToAcres(sqFt: number): string {
  return (sqFt / 43560).toFixed(2);
}
