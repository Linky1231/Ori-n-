export interface LocationResult {
  id: string;
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  type: string;
  category: string;
  address: {
    road?: string;
    suburb?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
  maps_url: string;
  directions_url: string;
  embed_url: string;
  satellite_embed_url: string;
  image_url?: string;
  thumbnail_url?: string;
  description?: string;
}

export async function fetchWikiPlace(
  placeName: string
): Promise<{ image?: string; thumbnail?: string; description?: string; coords?: { lat: number; lng: number } } | null> {
  const cleanName = placeName
    .replace(/(?:el|la|los|las)\s+/gi, '')
    .trim();

  const candidates = [
    placeName.trim(),
    cleanName,
    placeName.replace(/\s+/g, '_'),
    cleanName.replace(/\s+/g, '_'),
  ];

  for (const lang of ['es', 'en']) {
    for (const cand of candidates) {
      if (!cand) continue;
      try {
        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cand)}`;
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'OrionStellarApp/5.0 (https://orionstellar.app; contact@orionstellar.app)',
            'Accept-Language': 'es,en',
          },
        });
        if (res.ok) {
          const d = await res.json();
          if (d.thumbnail?.source || d.originalimage?.source || d.coordinates) {
            return {
              image: d.originalimage?.source || d.thumbnail?.source,
              thumbnail: d.thumbnail?.source,
              description: d.description || (d.extract ? d.extract.slice(0, 160) + '...' : undefined),
              coords: d.coordinates ? { lat: d.coordinates.lat, lng: d.coordinates.lon } : undefined,
            };
          }
        }
      } catch {
        // try next candidate
      }
    }
  }
  return null;
}

export async function searchLocation(query: string): Promise<LocationResult[]> {
  const q = (query || '').trim();
  if (!q) return [];

  try {
    // 1. Check if Wikipedia has a direct match for landmark / point
    const wikiPromise = fetchWikiPlace(q);

    // 2. Fetch Nominatim for exact addresses & geocoding
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=5`;

    const res = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'OrionStellarApp/5.0 (https://orionstellar.app; contact@orionstellar.app)',
        'Accept-Language': 'es,en',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const wikiData = await wikiPromise;

    let items: any[] = [];
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        items = data;
      }
    }

    // If wikiData has coordinates and either Nominatim found nothing or matched a minor residential street/highway,
    // prioritize the actual world landmark/monument by reverse geocoding its coordinates
    if (wikiData?.coords && (items.length === 0 || items[0].class === 'highway' || items[0].type === 'residential')) {
      const landmarkRes = await reverseGeocode(wikiData.coords.lat, wikiData.coords.lng);
      if (landmarkRes) {
        landmarkRes.name = q;
        landmarkRes.image_url = wikiData.image || wikiData.thumbnail;
        landmarkRes.thumbnail_url = wikiData.thumbnail || wikiData.image;
        landmarkRes.description = wikiData.description;
        return [landmarkRes, ...items];
      }
    }

    // If Nominatim gave no results but Wikipedia had coordinates, synthesize a result
    if (items.length === 0 && wikiData?.coords) {
      const lat = wikiData.coords.lat;
      const lng = wikiData.coords.lng;
      const maps_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
      const directions_url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      const embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=15&ie=UTF8&iwloc=&output=embed`;
      const satellite_embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`;

      return [
        {
          id: 'wiki-' + Math.random().toString(36).slice(2),
          name: q,
          display_name: `${q} (${wikiData.description || 'Punto de interés'})`,
          lat,
          lng,
          type: 'monumento',
          category: 'lugar_historico',
          address: {
            country: '',
          },
          maps_url,
          directions_url,
          embed_url,
          satellite_embed_url,
          image_url: wikiData.image || wikiData.thumbnail,
          thumbnail_url: wikiData.thumbnail || wikiData.image,
          description: wikiData.description,
        },
      ];
    }

    return items.map((item: any, index: number) => {
      let lat = parseFloat(item.lat);
      let lng = parseFloat(item.lon);

      // If this is the primary result and wikiData has high-precision coords, prioritize if relevant
      if (index === 0 && wikiData?.coords && Math.abs(lat - wikiData.coords.lat) < 0.5) {
        lat = wikiData.coords.lat;
        lng = wikiData.coords.lng;
      }

      const name = item.name || item.display_name.split(',')[0].trim();
      const addr = item.address || {};
      const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';

      const maps_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.display_name)}`;
      const directions_url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      const embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=15&ie=UTF8&iwloc=&output=embed`;
      const satellite_embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`;

      return {
        id: String(item.place_id || Math.random()),
        name,
        display_name: item.display_name,
        lat,
        lng,
        type: item.type || item.class || 'lugar',
        category: item.class || 'general',
        address: {
          road: addr.road,
          suburb: addr.suburb || addr.neighbourhood,
          city,
          state: addr.state || addr.region,
          country: addr.country,
          postcode: addr.postcode,
        },
        maps_url,
        directions_url,
        embed_url,
        satellite_embed_url,
        image_url: index === 0 ? (wikiData?.image || wikiData?.thumbnail) : undefined,
        thumbnail_url: index === 0 ? (wikiData?.thumbnail || wikiData?.image) : undefined,
        description: index === 0 ? wikiData?.description : undefined,
      };
    });
  } catch (err: any) {
    console.warn('searchLocation error:', err?.message || err);
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<LocationResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'OrionStellarApp/5.0 (https://orionstellar.app; contact@orionstellar.app)',
        'Accept-Language': 'es,en',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const item = await res.json();
    if (!item || !item.lat) return null;

    const name = item.name || item.display_name.split(',')[0].trim();
    const addr = item.address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';

    const maps_url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.display_name)}`;
    const directions_url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    const embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=15&ie=UTF8&iwloc=&output=embed`;
    const satellite_embed_url = `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`;

    const wiki = await fetchWikiPlace(name);

    return {
      id: String(item.place_id || Math.random()),
      name,
      display_name: item.display_name,
      lat,
      lng,
      type: item.type || item.class || 'lugar',
      category: item.class || 'general',
      address: {
        road: addr.road,
        suburb: addr.suburb || addr.neighbourhood,
        city,
        state: addr.state || addr.region,
        country: addr.country,
        postcode: addr.postcode,
      },
      maps_url,
      directions_url,
      embed_url,
      satellite_embed_url,
      image_url: wiki?.image || wiki?.thumbnail,
      thumbnail_url: wiki?.thumbnail || wiki?.image,
      description: wiki?.description,
    };
  } catch (err) {
    console.warn('reverseGeocode error:', err);
    return null;
  }
}
