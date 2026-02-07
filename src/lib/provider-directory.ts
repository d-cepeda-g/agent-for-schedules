export type TravelMode = "driving" | "walking" | "transit";

export type Coordinate = {
  lat: number;
  lng: number;
};

export type ProviderRecord = {
  id: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  rating: number;
  reviewCount: number;
  serviceTypes: string[];
  location: Coordinate;
};

const PROVIDER_DIRECTORY: ProviderRecord[] = [
  {
    id: "sf-dent-1",
    name: "Mission Dental Group",
    phone: "+14155550101",
    address: "123 Mission St",
    city: "San Francisco",
    rating: 4.8,
    reviewCount: 218,
    serviceTypes: ["dentist", "dental cleaning"],
    location: { lat: 37.7892, lng: -122.4014 },
  },
  {
    id: "sf-dent-2",
    name: "Soma Smile Clinic",
    phone: "+14155550102",
    address: "455 Howard St",
    city: "San Francisco",
    rating: 4.5,
    reviewCount: 143,
    serviceTypes: ["dentist", "orthodontist"],
    location: { lat: 37.7884, lng: -122.3964 },
  },
  {
    id: "sf-dent-3",
    name: "Sunset Family Dentistry",
    phone: "+14155550103",
    address: "2425 Irving St",
    city: "San Francisco",
    rating: 4.7,
    reviewCount: 96,
    serviceTypes: ["dentist", "family dentistry"],
    location: { lat: 37.7637, lng: -122.4845 },
  },
  {
    id: "sf-auto-1",
    name: "Bay Auto Repair",
    phone: "+14155550111",
    address: "810 Bryant St",
    city: "San Francisco",
    rating: 4.4,
    reviewCount: 321,
    serviceTypes: ["auto repair", "oil change"],
    location: { lat: 37.7747, lng: -122.4035 },
  },
  {
    id: "sf-auto-2",
    name: "Golden Gate Motors",
    phone: "+14155550112",
    address: "900 Lombard St",
    city: "San Francisco",
    rating: 4.6,
    reviewCount: 188,
    serviceTypes: ["auto repair", "tire shop"],
    location: { lat: 37.8028, lng: -122.4192 },
  },
  {
    id: "sf-auto-3",
    name: "Sunset Garage Works",
    phone: "+14155550113",
    address: "1475 9th Ave",
    city: "San Francisco",
    rating: 4.2,
    reviewCount: 77,
    serviceTypes: ["auto repair", "brake service"],
    location: { lat: 37.7617, lng: -122.4663 },
  },
  {
    id: "sf-hair-1",
    name: "Nob Hill Hair Studio",
    phone: "+14155550121",
    address: "1600 California St",
    city: "San Francisco",
    rating: 4.9,
    reviewCount: 265,
    serviceTypes: ["hairdresser", "hair salon"],
    location: { lat: 37.7908, lng: -122.4194 },
  },
  {
    id: "sf-hair-2",
    name: "Castro Style Barbers",
    phone: "+14155550122",
    address: "450 Castro St",
    city: "San Francisco",
    rating: 4.6,
    reviewCount: 171,
    serviceTypes: ["hairdresser", "barber"],
    location: { lat: 37.7607, lng: -122.4352 },
  },
  {
    id: "sf-hair-3",
    name: "Marina Glow Salon",
    phone: "+14155550123",
    address: "2158 Chestnut St",
    city: "San Francisco",
    rating: 4.3,
    reviewCount: 84,
    serviceTypes: ["hairdresser", "hair salon"],
    location: { lat: 37.8009, lng: -122.4378 },
  },
  {
    id: "sf-physio-1",
    name: "Pulse Physical Therapy",
    phone: "+14155550131",
    address: "600 Market St",
    city: "San Francisco",
    rating: 4.7,
    reviewCount: 109,
    serviceTypes: ["physical therapy", "rehab"],
    location: { lat: 37.7888, lng: -122.4018 },
  },
  {
    id: "sf-vision-1",
    name: "Embarcadero Vision Care",
    phone: "+14155550141",
    address: "1 Embarcadero Center",
    city: "San Francisco",
    rating: 4.5,
    reviewCount: 132,
    serviceTypes: ["optometrist", "vision exam"],
    location: { lat: 37.7952, lng: -122.3977 },
  },
  {
    id: "sf-peds-1",
    name: "Golden Pediatrics",
    phone: "+14155550151",
    address: "350 Parnassus Ave",
    city: "San Francisco",
    rating: 4.8,
    reviewCount: 204,
    serviceTypes: ["pediatrician", "clinic"],
    location: { lat: 37.7632, lng: -122.4586 },
  },
];

type ProviderSearchInput = {
  serviceType?: string;
  locationQuery?: string;
  minRating?: number;
  maxResults?: number;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function getProviderDirectory(): ProviderRecord[] {
  return PROVIDER_DIRECTORY.map((provider) => ({ ...provider }));
}

export function getProviderById(providerId: string): ProviderRecord | null {
  return PROVIDER_DIRECTORY.find((provider) => provider.id === providerId) ?? null;
}

export function searchProviders(input: ProviderSearchInput): ProviderRecord[] {
  const serviceType = input.serviceType ? normalizeText(input.serviceType) : "";
  const locationQuery = input.locationQuery ? normalizeText(input.locationQuery) : "";
  const minRating = typeof input.minRating === "number" ? input.minRating : 0;
  const maxResults = Math.max(1, Math.min(input.maxResults ?? 5, 20));

  return PROVIDER_DIRECTORY.filter((provider) => {
    if (provider.rating < minRating) return false;

    if (serviceType) {
      const hasServiceType = provider.serviceTypes.some((service) =>
        normalizeText(service).includes(serviceType)
      );
      if (!hasServiceType) return false;
    }

    if (locationQuery) {
      const haystack = `${provider.city} ${provider.address} ${provider.name}`.toLowerCase();
      if (!haystack.includes(locationQuery)) return false;
    }

    return true;
  })
    .sort((left, right) => {
      if (right.rating !== left.rating) return right.rating - left.rating;
      return right.reviewCount - left.reviewCount;
    })
    .slice(0, maxResults)
    .map((provider) => ({ ...provider }));
}

export function getDistanceKm(origin: Coordinate, destination: Coordinate): number {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLat = toRadians(destination.lat - origin.lat);
  const deltaLng = toRadians(destination.lng - origin.lng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(origin.lat)) *
      Math.cos(toRadians(destination.lat)) *
      Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

export function getTravelMinutes(distanceKm: number, mode: TravelMode = "driving"): number {
  const kmPerHour = mode === "walking" ? 5 : mode === "transit" ? 25 : 35;
  const minutes = (distanceKm / kmPerHour) * 60;
  return Math.max(1, Math.round(minutes));
}

