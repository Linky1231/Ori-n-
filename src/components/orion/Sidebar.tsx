import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { getDeviceId } from "@/lib/device";
import { sfx } from "@/lib/sounds";
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  MessageSquare,
  StickyNote,
  X,
  ImagePlus,
  Bug,
  LogOut,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { OrionLogo } from "./OrionLogo";
import { toast } from "sonner";

type Conv = { id: string; title: string; updated_at: string };

export function Sidebar({
  open,
  onClose,
  currentId,
  onSelect,
  onNew,
  onOpenNotes,
  onOpenDebug,
  onCreateImage,
}: {
  open: boolean;
  onClose: () => void;
  currentId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onOpenNotes: () => void;
  onOpenDebug: () => void;
  onCreateImage: () => void;
}) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // Confirmation states
  const [chatToDelete, setChatToDelete] = useState<Conv | null>(null);
  const [isDeletingSingle, setIsDeletingSingle] = useState(false);

  // 2-step confirmation for deleting all chats
  const [confirmAllStep, setConfirmAllStep] = useState<0 | 1 | 2>(0);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const { user } = useAuth();

  useEffect(() => {
    const did = getDeviceId();
    const qCol = query(
      collection(db, "conversations"),
      where("deviceId", "==", did)
    );

    const unsubscribe = onSnapshot(
      qCol,
      (snapshot) => {
        const list: Conv[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            title: d.title || "Conversación",
            updated_at: d.updatedAt || d.createdAt || new Date().toISOString(),
          };
        });
        list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        setConvs(list);
      },
      (error) => {
        console.warn("Sidebar conversations listener error:", error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const filtered = convs.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));

  async function rename(id: string) {
    try {
      await updateDoc(doc(db, "conversations", id), {
        title: editTitle || "Sin título",
        updatedAt: new Date().toISOString(),
      });
      toast.success("Conversación renombrada.");
    } catch (e) {
      console.warn("Rename conversation error:", e);
    }
    setEditing(null);
  }

  // Single chat deletion with confirmation
  async function confirmRemoveSingleChat() {
    if (!chatToDelete) return;
    setIsDeletingSingle(true);
    sfx.tap();
    const id = chatToDelete.id;
    try {
      await deleteDoc(doc(db, "conversations", id));
      // Delete associated messages
      const msgsQ = query(collection(db, "messages"), where("conversationId", "==", id));
      const mSnap = await getDocs(msgsQ);
      await Promise.all(mSnap.docs.map((m) => deleteDoc(m.ref)));

      toast.success("Conversación eliminada.");
      if (id === currentId) onNew();
      setChatToDelete(null);
    } catch (e) {
      console.warn("Delete conversation error:", e);
      toast.error("Error al eliminar la conversación.");
    } finally {
      setIsDeletingSingle(false);
    }
  }

  // Delete all chats with 2 confirmation steps
  async function executeRemoveAllChats() {
    setIsDeletingAll(true);
    sfx.tap();
    try {
      const did = getDeviceId();
      const qCol = query(collection(db, "conversations"), where("deviceId", "==", did));
      const snap = await getDocs(qCol);
      for (const convDoc of snap.docs) {
        const convId = convDoc.id;
        const msgsQ = query(collection(db, "messages"), where("conversationId", "==", convId));
        const mSnap = await getDocs(msgsQ);
        await Promise.all(mSnap.docs.map((m) => deleteDoc(m.ref)));
        await deleteDoc(convDoc.ref);
      }
      onNew();
      setConfirmAllStep(0);
      toast.success("Todas las conversaciones han sido eliminadas.");
    } catch (e) {
      console.warn("Delete all conversations error:", e);
      toast.error("Error al borrar todas las conversaciones.");
    } finally {
      setIsDeletingAll(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-40 md:hidden animate-fade-in"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed md:sticky top-0 left-0 h-screen w-[300px] z-50 liquid-glass rounded-none border-r border-border flex flex-col
          transition-transform duration-300 ease-out
          ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <OrionLogo size={32} />
            <div>
              <div className="text-sm font-semibold tracking-tight">Conversaciones</div>
              <div className="text-[11px] text-muted-foreground">Orión Estellar v5.0</div>
            </div>
          </div>
          <button
            className="md:hidden tap p-1.5 rounded-lg hover:bg-accent"
            onClick={() => {
              sfx.tap();
              onClose();
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 space-y-2">
          <button
            onClick={() => {
              sfx.tap();
              onNew();
            }}
            className="w-full tap btn-cosmic flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nueva conversación
          </button>
          <button
            onClick={() => {
              sfx.tap();
              onCreateImage();
            }}
            className="w-full tap btn-glass flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer"
          >
            <ImagePlus className="w-4 h-4 text-primary" /> Crear imagen con IA
          </button>
          <button
            onClick={() => {
              sfx.open();
              onOpenNotes();
            }}
            className="w-full tap btn-glass flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer"
          >
            <StickyNote className="w-4 h-4 text-primary" /> Modo Notas
          </button>
          <button
            onClick={() => {
              sfx.open();
              onOpenDebug();
            }}
            className="w-full tap btn-glass flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm cursor-pointer"
          >
            <Bug className="w-4 h-4 text-primary" /> Modo Debug
          </button>
        </div>

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-muted border border-transparent focus:border-ring focus:bg-card outline-none transition"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <div className="flex items-center justify-between px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Recientes ({convs.length})</span>
            {convs.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  sfx.tap();
                  setConfirmAllStep(1);
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-destructive/10 text-[11px] text-destructive transition-colors lowercase first-letter:uppercase font-medium cursor-pointer"
                title="Borrar todos los chats"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Borrar todos</span>
              </button>
            )}
          </div>
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Sin conversaciones</div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => {
                sfx.tap();
                onSelect(c.id);
                onClose();
              }}
              className={`group cursor-pointer px-3 py-2 rounded-xl mb-1 flex items-center gap-2 transition
                ${currentId === c.id ? "bg-accent" : "hover:bg-accent/60"}`}
            >
              <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
              {editing === c.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => rename(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && rename(c.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-card text-sm rounded px-2 py-0.5 border border-border outline-none"
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{c.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(c.updated_at).toLocaleString()}
                  </div>
                </div>
              )}
              <div className="opacity-80 md:opacity-0 group-hover:opacity-100 flex gap-1 transition">
                <button
                  className="p-1 rounded hover:bg-card"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(c.id);
                    setEditTitle(c.title);
                  }}
                  title="Renombrar chat"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1 rounded hover:bg-destructive/10 text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatToDelete(c);
                  }}
                  title="Eliminar este chat"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <ProfileFooter />
      </aside>

      {/* Modal 1: Confirmación para eliminar un chat individual */}
      {chatToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-destructive/30 max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Eliminar conversación?</h3>
                <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que deseas eliminar{" "}
              <strong className="text-foreground font-semibold">"{chatToDelete.title}"</strong> y todos los mensajes
              guardados en esta conversación?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={isDeletingSingle}
                onClick={() => {
                  sfx.tap();
                  setChatToDelete(null);
                }}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={isDeletingSingle}
                onClick={confirmRemoveSingleChat}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition cursor-pointer disabled:opacity-50"
              >
                {isDeletingSingle && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar conversación
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2 (Paso 1 de 2): Primera confirmación para eliminar todos los chats */}
      {confirmAllStep === 1 && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-destructive/30 max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Borrar todos los chats?</h3>
                <p className="text-xs text-muted-foreground font-medium text-destructive">Paso 1 de 2 de confirmación</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que deseas eliminar todas las conversaciones e historial de mensajes de este dispositivo?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  sfx.tap();
                  setConfirmAllStep(0);
                }}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  sfx.tap();
                  setConfirmAllStep(2);
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-destructive/85 hover:bg-destructive text-destructive-foreground transition cursor-pointer"
              >
                Continuar al paso final (2 de 2) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3 (Paso 2 de 2): Segunda confirmación definitiva para eliminar todos los chats */}
      {confirmAllStep === 2 && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/85 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border-2 border-destructive max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4 ring-4 ring-destructive/10">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive text-destructive-foreground">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">⚠️ Confirmación definitiva</h3>
                <p className="text-xs text-destructive font-semibold">Paso 2 de 2 · Acción irreversible</p>
              </div>
            </div>
            <p className="text-sm text-foreground/90 font-medium leading-relaxed">
              Esta es la advertencia final. Se eliminarán permanentemente todas las conversaciones, los mensajes, archivos
              y el historial completo. ¿Deseas proceder definitivamente?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={isDeletingAll}
                onClick={() => {
                  sfx.tap();
                  setConfirmAllStep(0);
                }}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={isDeletingAll}
                onClick={executeRemoveAllChats}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-destructive hover:bg-destructive/90 text-destructive-foreground transition cursor-pointer disabled:opacity-50 shadow-lg"
              >
                {isDeletingAll ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Borrando todo...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Sí, borrar todos los chats definitivamente
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProfileFooter() {
  const { user, profile, signOut } = useAuth();
  if (!user) return null;

  const name = profile?.display_name || user.displayName || user.email?.split("@")[0] || "Creador";
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="mt-auto border-t border-border p-3 flex items-center gap-2">
      {profile?.avatar_url || user.photoURL ? (
        <img
          src={profile?.avatar_url || user.photoURL || ""}
          alt={name}
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-[10px] text-muted-foreground truncate">{user.email || "Usuario"}</div>
      </div>
      <button
        title="Cerrar sesión"
        onClick={() => {
          sfx.tap();
          void signOut();
        }}
        className="tap p-2 rounded-lg hover:bg-accent transition-transform active:scale-95 cursor-pointer text-muted-foreground hover:text-destructive"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  );
}
