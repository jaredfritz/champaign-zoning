import { Suspense } from "react";
import { fetchZoningGeoJSON } from "@/lib/api";
import ZoningClient from "@/components/ZoningClient";
import permitsData from "@/data/residential-permits.json";

export default async function Home() {
  let data: GeoJSON.FeatureCollection;
  try {
    data = await fetchZoningGeoJSON();
  } catch (e) {
    console.error("Failed to fetch from GIS API:", e);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/zoning`);
    data = await res.json();
  }

  return (
    <Suspense fallback={<div className="h-[100dvh] bg-gray-50" />}>
      <ZoningClient data={data} permitsData={permitsData as GeoJSON.FeatureCollection} />
    </Suspense>
  );
}
