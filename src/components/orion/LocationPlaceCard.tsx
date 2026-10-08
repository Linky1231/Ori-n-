import { useState } from "react";
import {
  MapPin,
  ExternalLink,
  Navigation,
  Bookmark,
  Check,
  Camera,
  Map as MapIcon,
  Satellite,
  Maximize2,
  X,
  Compass,
  Copy,
} from "lucide-react";
import { addDoc, collection } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getDeviceId } from "@/lib/device";
import { toast } from "sonner";
import { sfx } from "@/lib/sounds";

export interface LocationPlaceData {
  id?: string;
  name: string;
  display_name: string;
  lat: number | string;
  lng: number | string;
  type?: string;
  category?: string;
  address?: {
    road?: string;
    suburb?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
  maps_url?: string;
  directions_url?: string;
  embed_url?: string;
  satellite_embed_url?: string;
  image_url?: string;
  thumbnail_url?: string;
  description?: string;
}

interface LocationPlaceCardProps {
  data: LocationPlaceData;
  url?: string;
  onOpenNotes?: () => void;
  onOpenMapModal?: (data: LocationPlaceData) => void;
}

export function LocationPlaceCard({ data, url, onOpenNotes, onOpenMapModal }: LocationPlaceCardProps) {
  const name = data?.name || "Punto de interés";
  const address = data?.display_name || "";
  const rawLat = typeof data?.lat === "number" ? data.lat : parseFloat(data?.lat || "0");
  const rawLng = typeof data?.lng === "number" ? data.lng : parseFloat(data?.lng || "0");
  const hasCoords = !isNaN(rawLat) && !isNaN(rawLng) && (rawLat !== 0 || rawLng !== 0);
  const lat = hasCoords ? rawLat : 0;
  const lng = hasCoords ? rawLng : 0;

  const photoUrl = data?.image_url || data?.thumbnail_url;
  const initialMode = photoUrl ? "photo" : "map";
  const [activeTab, setActiveTab] = useState<"photo" | "map" | "satellite">(initialMode);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const mapsUrl =
    url ||
    data?.maps_url ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data?.display_name || name)}`;
  const directionsUrl =
    data?.directions_url ||
    (hasCoords
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(name)}`);

  const embedMapUrl =
    data?.embed_url ||
    `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=15&ie=UTF8&iwloc=&output=embed`;
  const embedSatelliteUrl =
    data?.satellite_embed_url ||
    `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&ie=UTF8&iwloc=&output=embed`;

  function copyCoordinates() {
    if (!hasCoords) return;
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(text);
    setCopiedCoords(true);
    sfx.tap();
    toast.success(`Coordenadas copiadas: ${text}`);
    setTimeout(() => setCopiedCoords(false), 2000);
  }

  async function handleSaveToNotes() {
    if (isSaving || isSaved) return;
    setIsSaving(true);
    sfx.tap();

    try {
      const summaryText = data?.description ? `*${data.description}*\n\n` : "";
      const addressText = address ? `📍 **Dirección**: ${address}\n` : "";
      const coordsText = hasCoords ? `🌐 **Coordenadas**: \`${lat.toFixed(6)}, ${lng.toFixed(6)}\`\n` : "";
      const linksText = `\n- [Ver en Google Maps](${mapsUrl})\n- [Cómo llegar / Ruta](${directionsUrl})\n`;
      const imageMd = photoUrl ? `\n\n![${name}](${photoUrl})` : "";

      const did = getDeviceId();
      const now = new Date().toISOString();
      const content = `## ${name}\n\n${summaryText}${addressText}${coordsText}${linksText}${imageMd}`;

      await addDoc(collection(db, "notes"), {
        deviceId: did,
        title: `📍 ${name}`,
        content,
        section: "main",
        folderId: null,
        status: "stable",
        category: "otros",
        aiSummary: `Lugar: ${name} (${address.slice(0, 100)})`,
        createdAt: now,
        updatedAt: now,
        lastActivity: now,
      });

      setIsSaved(true);
      toast.success(`"${name}" se guardó en Modo Notas.`, {
        action: onOpenNotes
          ? {
              label: "Ver Notas",
              onClick: () => onOpenNotes(),
            }
          : undefined,
      });
      sfx.receive();
    } catch (e: any) {
      console.warn("Save place to notes error:", e);
      toast.error("No se pudo guardar la nota.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <div className="my-2 max-w-lg w-full rounded-2xl overflow-hidden border border-primary/30 liquid-glass shadow-lg transition-all duration-300 hover:border-primary/50">
        {/* Recuadro Visual de la Imagen / Mapa */}
        <div className="relative w-full aspect-video bg-black/40 overflow-hidden group">
          {activeTab === "photo" && photoUrl && (
            <div className="relative w-full h-full">
              <img
                src={photoUrl}
                alt={name}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onError={() => setActiveTab("map")}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />

              {/* Lightbox Trigger */}
              <button
                onClick={() => setLightboxOpen(true)}
                className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm cursor-pointer"
                title="Ampliar imagen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeTab === "map" && (
            <div className="w-full h-full relative">
              <iframe
                title={`Mapa de ${name}`}
                src={embedMapUrl}
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 right-2 pointer-events-none">
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/70 text-white/90 backdrop-blur-sm font-mono">
                  Google Maps
                </span>
              </div>
            </div>
          )}

          {activeTab === "satellite" && (
            <div className="w-full h-full relative">
              <iframe
                title={`Satélite de ${name}`}
                src={embedSatelliteUrl}
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
              <div className="absolute top-2 right-2 pointer-events-none">
                <span className="text-[10px] px-2 py-0.5 rounded-md bg-black/70 text-white/90 backdrop-blur-sm font-mono">
                  Vista Satélite
                </span>
              </div>
            </div>
          )}

          {/* Switcher de Vista (Foto / Mapa / Satélite) sobre el recuadro */}
          <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 p-1 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 z-10">
            {photoUrl && (
              <button
                onClick={() => {
                  setActiveTab("photo");
                  sfx.tap();
                }}
                className={`tap px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                  activeTab === "photo"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`}
              >
                <Camera className="w-3 h-3" />
                <span>Foto real</span>
              </button>
            )}
            <button
              onClick={() => {
                setActiveTab("map");
                sfx.tap();
              }}
              className={`tap px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                activeTab === "map"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              }`}
            >
              <MapIcon className="w-3 h-3" />
              <span>Mapa</span>
            </button>
            <button
              onClick={() => {
                setActiveTab("satellite");
                sfx.tap();
              }}
              className={`tap px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors ${
                activeTab === "satellite"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-white/80 hover:text-white hover:bg-white/10"
              }`}
            >
              <Satellite className="w-3 h-3" />
              <span>Satélite</span>
            </button>
          </div>
        </div>

        {/* Panel de Datos de Google Maps */}
        <div className="p-4 space-y-3">
          {/* Encabezado del Panel */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                  <Compass className="w-3 h-3" /> Google Maps Data
                </span>
                {data?.category && (
                  <span className="text-[10px] uppercase font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {data.type || data.category}
                  </span>
                )}
              </div>
              <h3 className="text-base font-bold text-foreground leading-snug tracking-tight">
                {name}
              </h3>
            </div>

            {/* Coordenadas GPS */}
            {hasCoords && (
              <button
                onClick={copyCoordinates}
                className="tap flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted hover:bg-accent border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                title="Copiar coordenadas GPS"
              >
                {copiedCoords ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3 text-muted-foreground" />
                )}
                <span>
                  {lat.toFixed(4)}°, {lng.toFixed(4)}°
                </span>
              </button>
            )}
          </div>

          {/* Breve descripción si existe */}
          {data?.description && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 italic">
              "{data.description}"
            </p>
          )}

          {/* Dirección completa formateada */}
          {address && (
            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-muted/60 border border-border/50 text-xs">
              <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1 text-muted-foreground leading-relaxed break-words">
                {address}
              </div>
            </div>
          )}

          {/* Acciones del Panel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="tap btn-cosmic py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer shadow-sm text-center"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Maps</span>
            </a>

            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              className="tap btn-glass py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer text-foreground text-center"
            >
              <Navigation className="w-3.5 h-3.5 text-primary" />
              <span>Ruta</span>
            </a>

            {onOpenMapModal && (
              <button
                onClick={() => {
                  sfx.open();
                  onOpenMapModal(data);
                }}
                className="tap btn-glass py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer text-foreground text-center"
                title="Abrir mapa interactivo"
              >
                <Compass className="w-3.5 h-3.5 text-primary" />
                <span>Explorar</span>
              </button>
            )}

            <button
              onClick={handleSaveToNotes}
              disabled={isSaving || isSaved}
              className={`tap py-2 px-3 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                isSaved
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "btn-glass text-foreground hover:border-primary/40"
              }`}
            >
              {isSaved ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-400" />
                  <span>Guardado</span>
                </>
              ) : (
                <>
                  <Bookmark className="w-3.5 h-3.5 text-primary" />
                  <span>{isSaving ? "Guardando…" : "Notas"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox modal para ver la imagen en alta resolución */}
      {lightboxOpen && photoUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-10 right-0 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={photoUrl}
              alt={name}
              className="max-w-full max-h-[75vh] object-contain rounded-xl shadow-2xl border border-white/10"
            />
            <div className="mt-3 text-center text-white">
              <h4 className="text-sm font-semibold">{name}</h4>
              {data?.description && (
                <p className="text-xs text-white/70 mt-0.5">{data.description}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
