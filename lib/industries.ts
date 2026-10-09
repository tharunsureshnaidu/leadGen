// ETA-friendly verticals: fragmented, owner-operated, often boomer-owned.
// `osm` = Overpass tag filters; `recurring` = service-contract / repeat revenue.
export const INDUSTRIES: Record<string, { label: string; osm: string[]; recurring: boolean }> = {
  hvac: { label: "HVAC", osm: ['["craft"="hvac"]', '["craft"="heating_engineer"]', '["name"~"heating|air condition|hvac",i]["shop"]'], recurring: true },
  plumbing: { label: "Plumbing", osm: ['["craft"="plumber"]'], recurring: true },
  electrical: { label: "Electrical contractors", osm: ['["craft"="electrician"]'], recurring: false },
  roofing: { label: "Roofing", osm: ['["craft"="roofer"]'], recurring: false },
  landscaping: { label: "Landscaping", osm: ['["craft"="gardener"]', '["name"~"landscap|lawn care",i]["office"]'], recurring: true },
  pest: { label: "Pest control", osm: ['["name"~"pest control|exterminat",i]'], recurring: true },
  accounting: { label: "Accounting & tax", osm: ['["office"="accountant"]', '["office"="tax_advisor"]'], recurring: true },
  insurance: { label: "Insurance agencies", osm: ['["office"="insurance"]'], recurring: true },
  dental: { label: "Dental practices", osm: ['["amenity"="dentist"]'], recurring: true },
  veterinary: { label: "Veterinary clinics", osm: ['["amenity"="veterinary"]'], recurring: true },
  auto: { label: "Auto repair", osm: ['["shop"="car_repair"]'], recurring: false },
  printing: { label: "Printing & signs", osm: ['["craft"="printer"]', '["shop"="copyshop"]', '["craft"="signmaker"]'], recurring: false },
  manufacturing: { label: "Light manufacturing", osm: ['["man_made"="works"]', '["craft"="metal_construction"]'], recurring: false },
};
