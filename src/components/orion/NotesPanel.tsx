import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { getDeviceId } from "@/lib/device";
import { sfx } from "@/lib/sounds";
import { classifyNote, analyzeProject } from "@/lib/orion-api";
import { OrionLogo } from "./OrionLogo";
import { toast } from "sonner";
import {
  X,
  Plus,
  Trash2,
  Save,
  Folder,
  FolderPlus,
  Sparkles,
  Brain,
  ArrowLeft,
  Wand2,
  Loader2,
  NotebookPen,
  Wrench,
  Gamepad2,
  BookOpen,
  LayoutDashboard,
  Network,
  Wallet,
  Volume2,
  Bug,
  Palette,
  Code,
  Pin,
  FolderInput,
  CheckSquare,
  Square,
  Check,
  Search,
} from "lucide-react";

type Note = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  created_at?: string;
  last_activity: string;
  folder_id: string | null;
  section: string;
  category: string | null;
  status: string;
  ai_summary: string | null;
};

type FolderRow = {
  id: string;
  name: string;
  section: string;
  status: string;
  color: string;
};

const SECTIONS = [
  { id: "main", label: "Notas", Icon: NotebookPen },
  { id: "dev", label: "Desarrollo", Icon: Wrench },
] as const;

const STATUS = {
  stable: { label: "Estable", color: "text-green-400", dotClass: "bg-green-500", bg: "bg-green-500/10" },
  development: { label: "En desarrollo", color: "text-yellow-400", dotClass: "bg-yellow-500", bg: "bg-yellow-500/10" },
  problematic: { label: "Problemático", color: "text-red-400", dotClass: "bg-red-500", bg: "bg-red-500/10" },
  abandoned: { label: "Abandonado", color: "text-zinc-400", dotClass: "bg-zinc-500", bg: "bg-zinc-500/10" },
} as const;

const CATEGORY_ICON: Record<string, any> = {
  gameplay: Gamepad2,
  lore: BookOpen,
  ui: LayoutDashboard,
  multiplayer: Network,
  economia: Wallet,
  audio: Volume2,
  bugs: Bug,
  arte: Palette,
  programacion: Code,
  otros: Pin,
};

const CATEGORIES_LIST = [
  { id: "gameplay", label: "Gameplay" },
  { id: "lore", label: "Historia / Lore" },
  { id: "ui", label: "Interfaz / UI" },
  { id: "multiplayer", label: "Multijugador" },
  { id: "economia", label: "Economía" },
  { id: "audio", label: "Audio / Sonido" },
  { id: "bugs", label: "Bugs / Fallos" },
  { id: "arte", label: "Arte / Visual" },
  { id: "programacion", label: "Programación" },
  { id: "otros", label: "Otros" },
];

const FOLDER_COLORS = [
  "#8b5cf6", // Purple
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Red
  "#ec4899", // Pink
  "#06b6d4", // Cyan
];

function StatusDot({ status, className = "" }: { status: string; className?: string }) {
  const st = STATUS[status as keyof typeof STATUS] || STATUS.development;
  return <span className={`inline-block w-2 h-2 rounded-full ${st.dotClass} ${className}`} />;
}

function CategoryIcon({ category, className = "w-3.5 h-3.5" }: { category: string | null | undefined; className?: string }) {
  if (!category) return null;
  const Icon = CATEGORY_ICON[category] || Pin;
  return <Icon className={className} />;
}

export function NotesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [section, setSection] = useState<"main" | "dev">("main");
  const [activeFolder, setActiveFolder] = useState<FolderRow | null>(null);
  const [active, setActive] = useState<Note | null>(null);
  const [searchNoteQuery, setSearchNoteQuery] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Modals state for creation and confirmations
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#8b5cf6");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [folderToDelete, setFolderToDelete] = useState<FolderRow | null>(null);
  const [deletingFolder, setDeletingFolder] = useState(false);

  const [noteToDelete, setNoteToDelete] = useState<Note | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);

  async function load() {
    const did = getDeviceId();
    try {
      const [fSnap, nSnap] = await Promise.all([
        getDocs(query(collection(db, "note_folders"), where("deviceId", "==", did))),
        getDocs(query(collection(db, "notes"), where("deviceId", "==", did))),
      ]);

      const fList: FolderRow[] = fSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || "Carpeta",
          section: data.section || "main",
          status: data.status || "development",
          color: data.color || "#8b5cf6",
        };
      });

      const nList: Note[] = nSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          title: data.title || "Sin título",
          content: data.content || "",
          updated_at: data.updatedAt || data.updated_at || data.createdAt || data.created_at || new Date().toISOString(),
          last_activity: data.lastActivity || data.last_activity || data.updatedAt || new Date().toISOString(),
          folder_id: data.folderId || data.folder_id || null,
          section: data.section || "main",
          category: data.category || null,
          status: data.status || "development",
          ai_summary: data.aiSummary || data.ai_summary || null,
        };
      });

      nList.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      setFolders(fList);
      setNotes(nList);
    } catch (e) {
      console.warn("Load notes error:", e);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  const visibleFolders = useMemo(() => folders.filter((f) => f.section === section), [folders, section]);
  const visibleNotes = useMemo(() => {
    if (activeFolder) return notes.filter((n) => n.folder_id === activeFolder.id);
    return notes.filter((n) => n.section === section && !n.folder_id);
  }, [notes, activeFolder, section]);

  const searchedNotes = useMemo(() => {
    if (!searchNoteQuery.trim()) return visibleNotes;
    const q = searchNoteQuery.toLowerCase();
    return visibleNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        (n.category && n.category.toLowerCase().includes(q))
    );
  }, [visibleNotes, searchNoteQuery]);

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
    setMoveOpen(false);
  }

  async function moveSelectedTo(folderId: string | null) {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    const updates: any = { folderId: folderId, lastActivity: new Date().toISOString() };
    if (folderId) {
      const target = folders.find((f) => f.id === folderId);
      if (target) updates.section = target.section;
    }

    try {
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.update(doc(db, "notes", id), updates);
      }
      await batch.commit();
      toast.success("Notas movidas correctamente.");
    } catch (e) {
      console.warn("Move notes error:", e);
      toast.error("Error al mover notas.");
    }

    sfx.tap();
    exitSelect();
    load();
  }

  // ---- CREAR CARPETA SIN WINDOW.PROMPT ----
  async function submitCreateFolder(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const name = newFolderName.trim();
    if (!name) {
      toast.error("Por favor ingresa un nombre para la carpeta.");
      return;
    }

    setCreatingFolder(true);
    sfx.tap();
    const did = getDeviceId();
    try {
      const ref = await addDoc(collection(db, "note_folders"), {
        deviceId: did,
        name,
        section,
        status: "development",
        color: newFolderColor,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const created: FolderRow = {
        id: ref.id,
        name,
        section,
        status: "development",
        color: newFolderColor,
      };

      setFolders((prev) => [...prev, created]);
      setNewFolderOpen(false);
      setNewFolderName("");
      toast.success(`Carpeta "${name}" creada.`);
      load();
    } catch (err: any) {
      console.warn("Error creating folder:", err);
      toast.error("No se pudo crear la carpeta.");
    } finally {
      setCreatingFolder(false);
    }
  }

  // ---- ELIMINAR CARPETA CON CONFIRMACIÓN MODAL ----
  async function confirmDeleteFolder() {
    if (!folderToDelete) return;
    setDeletingFolder(true);
    sfx.tap();
    try {
      await deleteDoc(doc(db, "note_folders", folderToDelete.id));

      // Optional: unassign notes from this folder in Firestore
      const targetNotes = notes.filter((n) => n.folder_id === folderToDelete.id);
      if (targetNotes.length > 0) {
        const batch = writeBatch(db);
        targetNotes.forEach((n) => {
          batch.update(doc(db, "notes", n.id), { folderId: null });
        });
        await batch.commit();
      }

      if (activeFolder?.id === folderToDelete.id) {
        setActiveFolder(null);
      }

      toast.success(`Carpeta "${folderToDelete.name}" eliminada.`);
      setFolderToDelete(null);
      load();
    } catch (e: any) {
      console.warn("Delete folder error:", e);
      toast.error("Error al eliminar la carpeta.");
    } finally {
      setDeletingFolder(false);
    }
  }

  async function setFolderStatus(id: string, status: string) {
    try {
      await updateDoc(doc(db, "note_folders", id), { status });
      load();
    } catch (e) {
      console.warn("Update folder status error:", e);
    }
  }

  // ---- CREAR NOTA ----
  async function createNote() {
    sfx.tap();
    const did = getDeviceId();
    try {
      const now = new Date().toISOString();
      const docRef = await addDoc(collection(db, "notes"), {
        deviceId: did,
        title: "Nueva nota",
        content: "",
        section,
        folderId: activeFolder?.id || null,
        status: "development",
        category: null,
        aiSummary: null,
        createdAt: now,
        updatedAt: now,
        lastActivity: now,
      });

      const newN: Note = {
        id: docRef.id,
        title: "Nueva nota",
        content: "",
        section,
        folder_id: activeFolder?.id || null,
        status: "development",
        category: null,
        ai_summary: null,
        created_at: now,
        updated_at: now,
        last_activity: now,
      };

      setNotes((prev) => [newN, ...prev]);
      setActive(newN);
      toast.success("Nueva nota creada.");
    } catch (e: any) {
      console.warn("Create note error:", e);
      toast.error("Error al crear la nota.");
    }
  }

  // ---- GUARDAR NOTA ----
  async function save() {
    if (!active) return;
    sfx.tap();
    try {
      await updateDoc(doc(db, "notes", active.id), {
        title: active.title || "Sin título",
        content: active.content || "",
        status: active.status,
        category: active.category,
        folderId: active.folder_id,
        updatedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
      toast.success("Nota guardada.");
      load();
    } catch (e: any) {
      console.warn("Save note error:", e);
      toast.error("Error al guardar la nota.");
    }
  }

  // ---- ELIMINAR NOTA CON CONFIRMACIÓN MODAL ----
  async function confirmDeleteNote() {
    if (!noteToDelete) return;
    setDeletingNote(true);
    sfx.tap();
    try {
      await deleteDoc(doc(db, "notes", noteToDelete.id));
      if (active?.id === noteToDelete.id) {
        setActive(null);
      }
      toast.success("Nota eliminada.");
      setNoteToDelete(null);
      load();
    } catch (e) {
      console.warn("Delete note error:", e);
      toast.error("Error al eliminar la nota.");
    } finally {
      setDeletingNote(false);
    }
  }

  async function classify() {
    if (!active) return;
    setClassifying(true);
    try {
      const r = await classifyNote(active.title, active.content);
      const updated = {
        ...active,
        category: r.category || active.category,
        status: r.status || active.status,
        section: r.section || active.section,
        ai_summary: r.summary || active.ai_summary,
      };
      await updateDoc(doc(db, "notes", active.id), {
        category: updated.category,
        status: updated.status,
        section: updated.section,
        aiSummary: updated.ai_summary,
        lastActivity: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setActive(updated);
      toast.success("Nota clasificada por Orión.");
      load();
    } catch (e) {
      console.error(e);
      toast.error("Error al clasificar nota.");
    } finally {
      setClassifying(false);
    }
  }

  async function runAnalysis() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const r = await analyzeProject(notes.slice(0, 30));
      setAnalysis(r);
    } catch (e: any) {
      setAnalysis("Error: " + e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-background animate-fade-up flex flex-col">
      {/* Header */}
      <header className="liquid-glass border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="tap p-2 rounded-xl hover:bg-accent cursor-pointer"
          title="Cerrar panel de notas"
        >
          <X className="w-5 h-5" />
        </button>
        <OrionLogo size={32} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold tracking-tight">Modo Notas</div>
          <div className="text-[11px] text-muted-foreground">
            Gestión de notas, carpetas inteligentes y análisis con Orión
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing || notes.length === 0}
          className="tap px-3.5 py-1.5 rounded-xl btn-cosmic text-primary-foreground text-xs md:text-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          <span className="hidden sm:inline">Analizar proyecto con Orión</span>
        </button>
      </header>

      {/* Sections bar */}
      <div className="border-b border-border px-4 flex items-center gap-2 bg-card/20">
        {SECTIONS.map((s) => {
          const Icon = s.Icon;
          const isActive = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => {
                sfx.tap();
                setSection(s.id as any);
                setActiveFolder(null);
                setActive(null);
                exitSelect();
              }}
              className={`tap px-4 py-2.5 text-sm border-b-2 transition flex items-center gap-1.5 cursor-pointer ${
                isActive
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" /> {s.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar: folders + notes */}
        <aside
          className={`${
            active || analysis !== null ? "hidden md:flex" : "flex"
          } w-full md:w-80 border-r border-border flex-col bg-card/40`}
        >
          {/* Breadcrumb / Top actions */}
          <div className="p-3 flex items-center gap-2 border-b border-border">
            {activeFolder ? (
              <>
                <button
                  onClick={() => {
                    setActiveFolder(null);
                    exitSelect();
                  }}
                  className="tap p-1.5 rounded-lg hover:bg-accent cursor-pointer"
                  title="Volver a todas las carpetas"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="text-sm truncate flex items-center gap-1.5 font-medium flex-1">
                  <StatusDot status={activeFolder.status} /> {activeFolder.name}
                </span>
                <button
                  onClick={() => setFolderToDelete(activeFolder)}
                  className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive cursor-pointer"
                  title="Eliminar esta carpeta"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            ) : (
              <span className="text-sm text-muted-foreground font-medium">Carpetas y notas</span>
            )}
            <div className="ml-auto flex gap-1">
              <button
                onClick={() => {
                  sfx.tap();
                  selectMode ? exitSelect() : setSelectMode(true);
                }}
                title={selectMode ? "Cancelar selección" : "Seleccionar notas"}
                className={`tap p-1.5 rounded-lg cursor-pointer ${
                  selectMode ? "bg-primary text-primary-foreground" : "hover:bg-accent"
                }`}
              >
                <CheckSquare className="w-4 h-4" />
              </button>
              {!activeFolder && !selectMode && (
                <button
                  onClick={() => {
                    sfx.tap();
                    setNewFolderOpen(true);
                  }}
                  title="Nueva carpeta"
                  className="tap p-1.5 rounded-lg hover:bg-accent cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              )}
              {!selectMode && (
                <button
                  onClick={createNote}
                  title="Nueva nota"
                  className="tap p-1.5 rounded-lg bg-primary text-primary-foreground cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Search bar */}
          <div className="px-3 py-2 border-b border-border/70">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={searchNoteQuery}
                onChange={(e) => setSearchNoteQuery(e.target.value)}
                placeholder="Buscar notas..."
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg bg-muted/60 border border-border/50 outline-none focus:border-ring transition"
              />
              {searchNoteQuery && (
                <button
                  onClick={() => setSearchNoteQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {selectMode && (
            <div className="px-3 py-2 border-b border-border bg-accent/30 flex items-center gap-2 relative">
              <span className="text-xs text-muted-foreground">
                {selected.size} seleccionada{selected.size === 1 ? "" : "s"}
              </span>
              <button
                disabled={selected.size === 0}
                onClick={() => setMoveOpen((v) => !v)}
                className="tap ml-auto px-2.5 py-1 rounded-lg bg-primary text-primary-foreground text-xs flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <FolderInput className="w-3 h-3" /> Mover a…
              </button>
              {moveOpen && (
                <div className="absolute top-full right-2 mt-1 z-10 w-56 bg-card border border-border rounded-xl shadow-soft p-1 max-h-72 overflow-y-auto">
                  <button
                    onClick={() => moveSelectedTo(null)}
                    className="w-full text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-accent flex items-center gap-2 cursor-pointer"
                  >
                    <Folder className="w-3.5 h-3.5 text-muted-foreground" /> Sin carpeta
                  </button>
                  {folders.length === 0 && (
                    <div className="text-[11px] text-muted-foreground px-2.5 py-2">Sin carpetas creadas.</div>
                  )}
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => moveSelectedTo(f.id)}
                      className="w-full text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-accent flex items-center gap-2 cursor-pointer"
                    >
                      <Folder className="w-3.5 h-3.5" style={{ color: f.color }} />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{f.section}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2">
            {/* Folders grid */}
            {!activeFolder && visibleFolders.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {visibleFolders.map((f) => {
                  const st = STATUS[f.status as keyof typeof STATUS] || STATUS.development;
                  const count = notes.filter((n) => n.folder_id === f.id).length;
                  return (
                    <div
                      key={f.id}
                      className={`group relative ${st.bg} border border-border rounded-xl p-3 cursor-pointer hover:scale-[1.02] transition`}
                      onClick={() => {
                        sfx.tap();
                        setActiveFolder(f);
                        setActive(null);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Folder className="w-5 h-5" style={{ color: f.color }} />
                        <StatusDot status={f.status} />
                      </div>
                      <div className="text-sm font-medium mt-1.5 truncate">{f.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {count} nota{count !== 1 ? "s" : ""}
                      </div>
                      <select
                        value={f.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setFolderStatus(f.id, e.target.value)}
                        className="absolute bottom-1 right-1 text-[9px] bg-card border border-border rounded px-1 opacity-80 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      >
                        {Object.entries(STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderToDelete(f);
                        }}
                        title="Eliminar carpeta"
                        className="absolute top-1 right-1 p-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Notes list */}
            <div className="space-y-1">
              {searchedNotes.map((n) => {
                const isSel = selected.has(n.id);
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      sfx.tap();
                      if (selectMode) toggleSelect(n.id);
                      else setActive(n);
                    }}
                    className={`group cursor-pointer px-3 py-2 rounded-xl flex items-start gap-2 transition ${
                      (!selectMode && active?.id === n.id) || isSel ? "bg-accent" : "hover:bg-accent/60"
                    }`}
                  >
                    {selectMode ? (
                      isSel ? (
                        <CheckSquare className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      )
                    ) : (
                      <StatusDot status={n.status} className="mt-1.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate flex items-center gap-1.5 font-medium">
                        {n.category && <CategoryIcon category={n.category} />}
                        {n.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {n.ai_summary || new Date(n.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    {!selectMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setNoteToDelete(n);
                        }}
                        title="Eliminar nota"
                        className="p-1.5 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 shrink-0 cursor-pointer opacity-70 group-hover:opacity-100 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {searchedNotes.length === 0 && searchNoteQuery && (
                <div className="text-center text-xs text-muted-foreground py-8">
                  No se encontraron notas que coincidan con "{searchNoteQuery}".
                </div>
              )}
              {visibleNotes.length === 0 && !searchNoteQuery && !activeFolder && visibleFolders.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-12 space-y-2">
                  <p>Sin notas en esta sección.</p>
                  <button
                    onClick={createNote}
                    className="tap px-3 py-1.5 rounded-xl bg-primary/15 text-primary text-xs font-medium cursor-pointer"
                  >
                    Crear mi primera nota
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Editor / analysis */}
        <section
          className={`${
            active || analysis !== null ? "flex" : "hidden md:flex"
          } flex-1 flex-col min-w-0 bg-card/20`}
        >
          {analysis !== null ? (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <OrionLogo size={36} glow />
                    <div>
                      <div className="font-semibold">Análisis integral del proyecto</div>
                      <div className="text-xs text-muted-foreground">Generado por Orión</div>
                    </div>
                  </div>
                  <button
                    onClick={() => setAnalysis(null)}
                    className="tap p-2 rounded-lg hover:bg-accent cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="glass-strong rounded-2xl p-5 whitespace-pre-wrap text-sm leading-relaxed shadow-soft">
                  <ReactMarkdown>{analysis}</ReactMarkdown>
                </div>
              </div>
            </div>
          ) : active ? (
            <>
              <div className="p-3 border-b border-border flex items-center gap-2 flex-wrap bg-card/40">
                <button
                  onClick={() => setActive(null)}
                  className="md:hidden tap p-1.5 rounded-lg hover:bg-accent cursor-pointer"
                  title="Volver a la lista de notas"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Carpeta:</span>
                  <select
                    value={active.folder_id || ""}
                    onChange={(e) => setActive({ ...active, folder_id: e.target.value || null })}
                    className="text-xs bg-card border border-border rounded-lg px-2 py-1 outline-none max-w-[130px] truncate"
                  >
                    <option value="">📁 Sin carpeta</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        📁 {f.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Estado:</span>
                  <select
                    value={active.status}
                    onChange={(e) => setActive({ ...active, status: e.target.value })}
                    className="text-xs bg-card border border-border rounded-lg px-2 py-1 outline-none"
                  >
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Categoría:</span>
                  <select
                    value={active.category || ""}
                    onChange={(e) => setActive({ ...active, category: e.target.value || null })}
                    className="text-xs bg-card border border-border rounded-lg px-2 py-1 outline-none"
                  >
                    <option value="">Sin categoría</option>
                    {CATEGORIES_LIST.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={classify}
                    disabled={classifying || !active.content}
                    className="tap px-2.5 py-1 rounded-lg bg-secondary text-secondary-foreground text-xs flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    title="Clasificar automáticamente con IA de Orión"
                  >
                    {classifying ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : <Wand2 className="w-3 h-3" />}
                    <span className="hidden sm:inline">Auto-clasificar</span>
                  </button>
                  <button
                    onClick={save}
                    className="tap px-3 py-1 rounded-lg bg-primary text-primary-foreground text-xs flex items-center gap-1 font-medium cursor-pointer"
                  >
                    {isSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                    {isSaved ? "Guardado" : "Guardar"}
                  </button>
                  <button
                    onClick={() => setNoteToDelete(active)}
                    className="tap p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                    title="Eliminar esta nota"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col p-4 md:p-6 gap-3 overflow-y-auto">
                <input
                  value={active.title}
                  onChange={(e) => setActive({ ...active, title: e.target.value })}
                  className="text-2xl font-bold bg-transparent outline-none border-b border-border pb-2"
                  placeholder="Título de la nota"
                />
                {active.ai_summary && (
                  <div className="text-xs text-muted-foreground italic flex items-start gap-1.5 p-2 rounded-lg bg-muted/40">
                    <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                    <span>Resumen: {active.ai_summary}</span>
                  </div>
                )}
                <textarea
                  value={active.content}
                  onChange={(e) => setActive({ ...active, content: e.target.value })}
                  placeholder="Escribe tus ideas, mecánicas, bugs, diálogos, sistemas, ubicaciones, mapas, tareas, inspiración… Orión sincronizará los cambios automáticamente."
                  className="flex-1 bg-transparent outline-none resize-none text-sm leading-relaxed min-h-[300px]"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm gap-3 p-8 text-center">
              <OrionLogo size={64} />
              <div className="font-semibold text-foreground text-base">Selecciona o crea una nota para empezar</div>
              <div className="text-xs max-w-md leading-relaxed">
                Las notas se sincronizan en Firestore y se clasifican con IA. Puedes organizarlas en carpetas o vincular ubicaciones desde el Explorador de Google Maps.
              </div>
              <button
                onClick={createNote}
                className="tap btn-cosmic px-4 py-2 rounded-xl text-sm font-medium text-primary-foreground flex items-center gap-1.5 mt-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Crear nota
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Modal: Crear nueva carpeta */}
      {newFolderOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-border max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-primary/15 text-primary">
                <FolderPlus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">Crear nueva carpeta</h3>
                <p className="text-xs text-muted-foreground">Organiza tus notas por categoría o sistema</p>
              </div>
            </div>

            <form onSubmit={submitCreateFolder} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Nombre de la carpeta
                </label>
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ej: Historia, Niveles, Bugs, Ideas..."
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-muted border border-border focus:border-ring focus:bg-card outline-none transition"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Color distintivo
                </label>
                <div className="flex items-center gap-2">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFolderColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                        newFolderColor === c ? "scale-125 ring-2 ring-foreground" : "hover:scale-110"
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    sfx.tap();
                    setNewFolderOpen(false);
                    setNewFolderName("");
                  }}
                  className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingFolder || !newFolderName.trim()}
                  className="tap btn-cosmic px-4 py-2 rounded-xl text-sm font-medium text-primary-foreground transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {creatingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Crear carpeta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirmación para eliminar carpeta */}
      {folderToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-destructive/30 max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Eliminar carpeta?</h3>
                <p className="text-xs text-muted-foreground">Confirmación de eliminación</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que deseas eliminar la carpeta{" "}
              <strong className="text-foreground font-semibold">"{folderToDelete.name}"</strong>? Las notas que
              contiene no se perderán y quedarán disponibles sin carpeta asignada.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={deletingFolder}
                onClick={() => {
                  sfx.tap();
                  setFolderToDelete(null);
                }}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={deletingFolder}
                onClick={confirmDeleteFolder}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition cursor-pointer disabled:opacity-50"
              >
                {deletingFolder && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar carpeta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmación para eliminar nota */}
      {noteToDelete && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-destructive/30 max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Eliminar nota?</h3>
                <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que deseas eliminar la nota{" "}
              <strong className="text-foreground font-semibold">"{noteToDelete.title}"</strong>? Se borrará
              permanentemente de tu proyecto.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={deletingNote}
                onClick={() => {
                  sfx.tap();
                  setNoteToDelete(null);
                }}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={deletingNote}
                onClick={confirmDeleteNote}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition cursor-pointer disabled:opacity-50"
              >
                {deletingNote && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar nota
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
