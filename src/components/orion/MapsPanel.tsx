import { useState, useEffect } from "react";
import { db } from "@/lib/firebase";
import { collection, addDoc } from "firebase/firestore";
import { getDeviceId } from "@/lib/device";
import { sfx } from "@/lib/sounds";
import { OrionLogo } from "./OrionLogo";
import { toast } from "sonner";
import {
  X,
  Search,
  MapPin,
  Navigation,
  ExternalLink,
  Copy,
  Check,
  Save,
  Compass,
  Layers,
  LocateFixed,
  Loader2,
  Sparkles,
  Info,
} from "lucide-react";

export interface LocationData {
  id: string;
  name: string;
  display_name: string;
  lat: number;
  lng: number;
  type: string;
  category: string;
  address?: {
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
}

const PRESET_PLACES = [
  { name: "Torre Eiffel", query: "Torre Eiffel, París" },
  { name: "Coliseo Romano", query: "Coliseo Romano, Roma, Italia" },
  { name: "Tokio", query: "Shibuya, Tokio, Japón" },
  { name: "Machu Picchu", query: "Machu Picchu, Cusco, Perú" },
  { name: "Sagrada Familia", query: "Sagrada Familia, Barcelona, España" },
  { name: "Times Square", query: "Times Square, Nueva York" },
  { name: "Chichén Itzá", query: "Chichén Itzá, Yucatán, México" },
  { name: "Gran Cañón", query: "Gran Cañón, Arizona, EE.UU." },
];

export function MapsPanel({
  open,
  onClose,
  initialPlace,
  onOpenNotes,
}: {
  open: boolean;
  onClose: () => void;
  initialPlace?: LocationData | null;
  onOpenNotes?: () => void;
}) {
  const [queryText, setQueryText] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [results, setResults] = useState<LocationData[]>([]);
  const [currentPlace, setCurrentPlace] = useState<LocationData | null>(null);
  const [copied, setCopied] = useState(false);
  const [mapType, setMapType] = useState<"m" | "k">("m"); // m = normal map, k = satellite
  const [zoom, setZoom] = useState(16);
  const [savingNote, setSavingNote] = useState(false);

  // Set default or initial place
  useEffect(() => {
    if (initialPlace) {
      setCurrentPlace(initialPlace);
      setQueryText(initialPlace.name);
    } else if (!currentPlace) {
      // Default to Torre Eiffel for an initial clean view
      searchPlace("Torre Eiffel, París", true);
    }
  }, [initialPlace, open]);

  async function searchPlace(q: string, isSilent = false) {
    const text = q.trim();
    if (!text) return;
    if (!isSilent) sfx.tap();
    setSearching(true);

    try {
      const res = await fetch(`/api/maps/search?q=${encodeURIComponent(text)}`);
      const data = await res.json();
      const list: LocationData[] = data.results || [];

      if (list.length > 0) {
        setResults(list);
        setCurrentPlace(list[0]);
      } else if (!isSilent) {
        toast.error("No se encontraron resultados para esta ubicación.");
      }
    } catch (e: any) {
      console.warn("Maps search error:", e);
      if (!isSilent) toast.error("Error al buscar en Google Maps Data.");
    } finally {
      setSearching(false);
    }
  }

  function handleLocateMe() {
    sfx.tap();
    if (!navigator.geolocation) {
      toast.error("Tu navegador no soporta geolocalización.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        try {
          const res = await fetch(`/api/maps/reverse?lat=${lat}&lng=${lng}`);
          const data = await res.json();
          if (data?.result) {
            setCurrentPlace(data.result);
            setQueryText(data.result.name || "Mi ubicación actual");
            setResults([data.result]);
            toast.success("¡Ubicación actual detectada!");
          } else {
            // Fallback object
            const fallback: LocationData = {
              id: "gps-" + Date.now(),
              name: "Mi ubicación GPS",
              display_name: `Coordenadas: ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
              lat,
              lng,
              type: "gps",
              category: "ubicación",
              maps_url: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
              directions_url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
              embed_url: `https://maps.google.com/maps?q=${lat},${lng}&t=&z=16&ie=UTF8&iwloc=&output=embed`,
            };
            setCurrentPlace(fallback);
            toast.success("Coordenadas GPS obtenidas.");
          }
        } catch {
          toast.error("No se pudo obtener el nombre de la dirección.");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        console.warn("Geolocation error:", err);
        toast.error("Permiso de ubicación denegado o no disponible.");
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }

  function copyCoords() {
    if (!currentPlace) return;
    sfx.tap();
    const str = `${currentPlace.lat.toFixed(6)}, ${currentPlace.lng.toFixed(6)}`;
    navigator.clipboard.writeText(str);
    setCopied(true);
    toast.success(`Coordenadas copiadas: ${str}`);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveToNotes() {
    if (!currentPlace) return;
    setSavingNote(true);
    sfx.tap();
    const did = getDeviceId();
    try {
      const addressLines = [
        currentPlace.address?.road,
        currentPlace.address?.city,
        currentPlace.address?.state,
        currentPlace.address?.country,
      ].filter(Boolean).join(", ") || currentPlace.display_name;

      const noteTitle = `📍 ${currentPlace.name}`;
      const noteContent = `### ${currentPlace.name}\n` +
        `**Dirección completa:** ${currentPlace.display_name}\n\n` +
        `**Coordenadas GPS:** \`${currentPlace.lat.toFixed(6)}, ${currentPlace.lng.toFixed(6)}\`\n` +
        `**Tipo:** ${currentPlace.type} · ${currentPlace.category}\n\n` +
        `#### Enlaces de navegación Google Maps:\n` +
        `- [Abrir en Google Maps](${currentPlace.maps_url})\n` +
        `- [Cómo llegar (Ruta)](${currentPlace.directions_url})\n\n` +
        `*Guardado automáticamente desde el Explorador Google Maps de Orión el ${new Date().toLocaleString()}*`;

      await addDoc(collection(db, "notes"), {
        deviceId: did,
        title: noteTitle,
        content: noteContent,
        section: "main",
        folderId: null,
        status: "stable",
        category: "otros",
        aiSummary: `Ubicación: ${currentPlace.name} (${addressLines})`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      });

      toast.success("¡Lugar guardado con éxito en el Modo Notas!");
      if (onOpenNotes) {
        setTimeout(() => {
          onClose();
          onOpenNotes();
        }, 600);
      }
    } catch (e: any) {
      console.warn("Save note error:", e);
      toast.error("Error al guardar nota en Firestore.");
    } finally {
      setSavingNote(false);
    }
  }

  if (!open) return null;

  // Build clean embed URL with zoom & map type
  const embedUrl = currentPlace
    ? `https://maps.google.com/maps?q=${currentPlace.lat},${currentPlace.lng}&t=${mapType}&z=${zoom}&ie=UTF8&iwloc=&output=embed`
    : "";

  return (
    <div className="fixed inset-0 z-[75] bg-background/90 backdrop-blur-md animate-fade-up flex flex-col">
      {/* Header */}
      <header className="liquid-glass border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => {
            sfx.tap();
            onClose();
          }}
          className="tap p-2 rounded-xl hover:bg-accent cursor-pointer"
          title="Cerrar panel de Google Maps"
        >
          <X className="w-5 h-5" />
        </button>
        <OrionLogo size={32} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold tracking-tight">Explorador de Google Maps</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
              Google Maps Data
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            Ubicaciones verificadas en tiempo real sin requerir API Key
          </div>
        </div>
      </header>

      {/* Search & Suggestions Bar */}
      <div className="border-b border-border bg-card/40 px-4 py-3 space-y-2.5">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchPlace(queryText)}
              placeholder="Busca cualquier lugar, ciudad, calle, monumento o coordenadas..."
              className="w-full pl-10 pr-10 py-2.5 text-sm rounded-xl bg-muted/60 border border-border focus:border-ring focus:bg-card outline-none transition shadow-inner"
            />
            {queryText && (
              <button
                onClick={() => setQueryText("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => searchPlace(queryText)}
            disabled={searching || !queryText.trim()}
            className="tap btn-cosmic px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
          >
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span className="hidden sm:inline">Buscar</span>
          </button>

          <button
            onClick={handleLocateMe}
            disabled={locating}
            title="Detectar mi ubicación actual vía GPS"
            className="tap btn-glass px-3.5 py-2.5 rounded-xl text-sm flex items-center gap-1.5 text-foreground cursor-pointer shrink-0"
          >
            {locating ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : <LocateFixed className="w-4 h-4 text-primary" />}
            <span className="hidden md:inline">Mi GPS</span>
          </button>
        </div>

        {/* Quick pill destinations */}
        <div className="max-w-4xl mx-auto flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
          <span className="text-muted-foreground text-[11px] shrink-0 font-medium mr-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-primary" /> Destinos:
          </span>
          {PRESET_PLACES.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setQueryText(p.query);
                searchPlace(p.query);
              }}
              className="tap px-2.5 py-1 rounded-lg bg-accent/60 hover:bg-accent text-foreground text-xs whitespace-nowrap transition cursor-pointer"
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Multiple results picker */}
        {results.length > 1 && (
          <div className="max-w-4xl mx-auto flex items-center gap-2 overflow-x-auto pt-1 pb-1">
            <span className="text-[11px] text-muted-foreground shrink-0 font-medium">Resultados:</span>
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => {
                  sfx.tap();
                  setCurrentPlace(r);
                }}
                className={`tap px-2.5 py-1 rounded-lg text-xs truncate max-w-[200px] border transition cursor-pointer ${
                  currentPlace?.id === r.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Content Area - Split Clean View */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 h-full">
          {/* Map Column (7 cols on desktop) */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="liquid-glass rounded-2xl border border-border overflow-hidden flex flex-col relative shadow-soft">
              {/* Map controls header */}
              <div className="px-4 py-2.5 bg-card/60 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Vista interactiva Google Maps
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg bg-muted p-0.5 text-xs">
                    <button
                      onClick={() => { sfx.tap(); setMapType("m"); }}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                        mapType === "m" ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground"
                      }`}
                    >
                      Mapa
                    </button>
                    <button
                      onClick={() => { sfx.tap(); setMapType("k"); }}
                      className={`px-2 py-0.5 rounded-md transition cursor-pointer ${
                        mapType === "k" ? "bg-card font-medium text-foreground shadow-xs" : "text-muted-foreground"
                      }`}
                    >
                      Satélite
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 text-xs">
                    <button
                      onClick={() => setZoom((z) => Math.max(z - 1, 4))}
                      className="px-2 py-0.5 rounded hover:bg-card cursor-pointer"
                      title="Alejar"
                    >
                      -
                    </button>
                    <span className="text-[11px] font-mono px-1">{zoom}x</span>
                    <button
                      onClick={() => setZoom((z) => Math.min(z + 1, 19))}
                      className="px-2 py-0.5 rounded hover:bg-card cursor-pointer"
                      title="Acercar"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Map iFrame */}
              <div className="relative w-full h-[360px] sm:h-[440px] md:h-[500px] bg-muted">
                {currentPlace ? (
                  <iframe
                    title={currentPlace.name}
                    src={embedUrl}
                    className="w-full h-full border-0"
                    loading="lazy"
                    allowFullScreen
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-6 text-center">
                    <Compass className="w-10 h-10 mb-2 opacity-40 animate-pulse" />
                    <p className="text-sm font-medium">Buscando mapa...</p>
                  </div>
                )}

                {/* Floating GPS badge */}
                {currentPlace && (
                  <div className="absolute bottom-3 left-3 bg-background/85 backdrop-blur-md border border-border px-3 py-1.5 rounded-xl shadow-lg text-[11px] font-mono flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>
                      {currentPlace.lat.toFixed(5)}°, {currentPlace.lng.toFixed(5)}°
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Details Column (5 cols on desktop) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {currentPlace ? (
              <>
                {/* Main Place Card */}
                <div className="liquid-glass rounded-2xl border border-border p-5 space-y-4 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-primary/15 text-primary">
                          {currentPlace.type}
                        </span>
                        <span className="text-[11px] text-muted-foreground capitalize">
                          {currentPlace.category}
                        </span>
                      </div>
                      <h2 className="text-xl font-bold tracking-tight text-foreground mt-1.5">
                        {currentPlace.name}
                      </h2>
                    </div>

                    <button
                      onClick={saveToNotes}
                      disabled={savingNote}
                      title="Guardar en Modo Notas"
                      className="tap btn-cosmic p-2.5 rounded-xl text-primary-foreground cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {savingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Formatted Address */}
                  <div className="p-3.5 rounded-xl bg-card border border-border space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-primary" /> Dirección completa
                      </span>
                    </div>
                    <p className="text-xs text-foreground leading-relaxed">
                      {currentPlace.display_name}
                    </p>
                  </div>

                  {/* GPS & Technical Specs */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-3 rounded-xl bg-card/60 border border-border space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">Latitud</span>
                      <div className="font-mono font-medium text-foreground">{currentPlace.lat.toFixed(6)}°</div>
                    </div>
                    <div className="p-3 rounded-xl bg-card/60 border border-border space-y-1">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">Longitud</span>
                      <div className="font-mono font-medium text-foreground">{currentPlace.lng.toFixed(6)}°</div>
                    </div>
                  </div>

                  {/* Actions Grid */}
                  <div className="space-y-2 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={currentPlace.maps_url}
                        target="_blank"
                        rel="noreferrer"
                        className="tap btn-glass px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer text-foreground"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-primary" /> Abrir en Maps
                      </a>

                      <a
                        href={currentPlace.directions_url}
                        target="_blank"
                        rel="noreferrer"
                        className="tap btn-glass px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer text-foreground"
                      >
                        <Navigation className="w-3.5 h-3.5 text-primary" /> Cómo llegar
                      </a>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={copyCoords}
                        className="tap btn-glass px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer text-foreground"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "¡Copiadas!" : "Copiar coordenadas"}
                      </button>

                      <button
                        onClick={saveToNotes}
                        disabled={savingNote}
                        className="tap btn-cosmic px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Guardar en Notas
                      </button>
                    </div>
                  </div>
                </div>

                {/* Nearby explore tips */}
                <div className="liquid-glass rounded-2xl border border-border p-4 space-y-2.5 shadow-soft">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Sparkles className="w-4 h-4 text-primary" /> Explorar en esta zona
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {[
                      { label: "🍽️ Restaurantes", q: `restaurantes cerca de ${currentPlace.name}` },
                      { label: "🏨 Hoteles", q: `hoteles cerca de ${currentPlace.name}` },
                      { label: "☕ Cafeterías", q: `cafés cerca de ${currentPlace.name}` },
                      { label: "🏛️ Museos", q: `museos en ${currentPlace.address?.city || currentPlace.name}` },
                      { label: "🌳 Parques", q: `parques en ${currentPlace.address?.city || currentPlace.name}` },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => {
                          setQueryText(item.q);
                          searchPlace(item.q);
                        }}
                        className="tap px-2.5 py-1 rounded-lg bg-card border border-border hover:bg-accent text-xs transition cursor-pointer"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="liquid-glass rounded-2xl border border-border p-6 flex flex-col items-center justify-center text-center text-muted-foreground h-full min-h-[300px]">
                <Info className="w-8 h-8 mb-2 opacity-50" />
                <h3 className="font-semibold text-foreground text-sm">Sin lugar seleccionado</h3>
                <p className="text-xs max-w-xs mt-1 leading-relaxed">
                  Realiza una búsqueda arriba o pulsa en uno de los destinos recomendados para ver sus datos reales.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
