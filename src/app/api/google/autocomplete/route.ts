import { NextRequest, NextResponse } from "next/server";

const AUTOCOMPLETE_ENDPOINT = "https://maps.googleapis.com/maps/api/place/autocomplete/json";

function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null;
}

export async function GET(req: NextRequest) {
  const key = getApiKey();
  if (!key) {
    return NextResponse.json({ predictions: [], source: "google", error: "Google Maps API key not configured" });
  }

  const input = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!input) return NextResponse.json({ predictions: [] });

  const params = new URLSearchParams({
    key,
    input,
    components: "country:us",
    locationbias: "rectangle:40.0,-88.4|40.25,-88.1",
    strictbounds: "true",
    types: "address",
  });

  const url = `${AUTOCOMPLETE_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json({ predictions: [], source: "google", error: "Autocomplete lookup failed" });
  }

  const payload = await res.json();
  if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    return NextResponse.json({ predictions: [], source: "google", error: payload.status });
  }

  const predictions = (payload.predictions ?? []).slice(0, 6).map((p: {
    description: string;
    place_id: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }) => ({
    description: p.description,
    placeId: p.place_id,
    primaryText: p.structured_formatting?.main_text ?? p.description,
    secondaryText: p.structured_formatting?.secondary_text ?? "",
  }));

  return NextResponse.json({ predictions, source: "google" });
}
