import { useEffect, useState, useRef } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { sfx } from "@/lib/sounds";
import { uploadAttachment } from "@/lib/orion-api";
import { toast } from "sonner";
import {
  X,
  Plus,
  Trash2,
  Save,
  Upload,
  Image as ImageIcon,
  Pencil,
  Code2,
  FileText,
  FileUp,
  Files,
  CheckCircle2,
  Loader2,
} from "lucide-react";

type KB = { id: string; title: string; content: string };
type Ref = { id: string; name: string; url: string; description: string };
type Builda = { id: string; title: string; description: string | null; code: string };

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"config" | "kb" | "refs" | "builda">("config");

  const [cfg, setCfg] = useState<any>({
    context: "Orión Estellar v5.0 para desarrollo de videojuegos.",
    personality: "Asistente inteligente, técnica, inspiradora y empática.",
    behavior: "Responde de forma clara y estructurada, proporcionando código robusto y sugerencias de diseño.",
  });
  const [kb, setKb] = useState<KB[]>([]);
  const [refs, setRefs] = useState<Ref[]>([]);
  const [builda, setBuilda] = useState<Builda[]>([]);
  const [newKb, setNewKb] = useState({ title: "", content: "" });
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [isDraggingKb, setIsDraggingKb] = useState(false);
  const [isUploadingBatch, setIsUploadingBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [editKbId, setEditKbId] = useState<string | null>(null);
  const [editKbDraft, setEditKbDraft] = useState({ title: "", content: "" });
  const [editLoadedFileName, setEditLoadedFileName] = useState<string | null>(null);
  const [newRefName, setNewRefName] = useState("");
  const [newRefDesc, setNewRefDesc] = useState("");
  const [newBuilda, setNewBuilda] = useState({ title: "", description: "", code: "" });
  const [buildaFileName, setBuildaFileName] = useState<string | null>(null);
  const [editBuildaId, setEditBuildaId] = useState<string | null>(null);
  const [editBuildaDraft, setEditBuildaDraft] = useState({ title: "", description: "", code: "" });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const buildaFileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [cSnap, kSnap, rSnap, bSnap] = await Promise.all([
        getDoc(doc(db, "orion_config", "main")),
        getDocs(collection(db, "orion_knowledge")),
        getDocs(collection(db, "orion_reference_images")),
        getDocs(collection(db, "orion_builda_scripts")),
      ]);

      if (cSnap.exists()) {
        setCfg(cSnap.data());
      }
      setKb(kSnap.docs.map((d) => ({ id: d.id, ...d.data() } as KB)));
      setRefs(rSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Ref)));
      setBuilda(bSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Builda)));
    } catch (e) {
      console.warn("Load admin data error:", e);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function saveCfg() {
    sfx.tap();
    try {
      await setDoc(
        doc(db, "orion_config", "main"),
        {
          personality: cfg.personality || "",
          behavior: cfg.behavior || "",
          context: cfg.context || "",
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      toast.success("Configuración de Orión guardada correctamente en Firestore.");
    } catch (e: any) {
      console.error(e);
      toast.error("Error al guardar configuración: " + e.message);
    }
  }

  async function handleTextFileUpload(file: File) {
    try {
      const text = await file.text();
      if (!text || !text.trim()) {
        toast.error("El archivo de texto está vacío o no contiene texto legible.");
        return;
      }
      const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
      const formattedTitle = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : "";

      setNewKb((prev) => ({
        title: prev.title.trim() ? prev.title : formattedTitle,
        content: text,
      }));
      setLoadedFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      sfx.pop();
      toast.success(`Archivo cargado: ${file.name}`);
    } catch (e: any) {
      console.error("Error al leer archivo de texto:", e);
      toast.error("Error al leer el archivo de texto: " + (e?.message || e));
    }
  }

  async function handleBatchTextFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;

    setIsUploadingBatch(true);
    setBatchStatus(`Leyendo ${list.length} archivo(s)...`);
    let count = 0;
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        setBatchStatus(`Procesando (${i + 1}/${list.length}): ${file.name}...`);
        const text = await file.text();
        if (!text || !text.trim()) continue;

        const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
        const formattedTitle = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : `Entrada ${i + 1}`;

        await addDoc(collection(db, "orion_knowledge"), {
          title: formattedTitle,
          content: text,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        count++;
      }
      sfx.pop();
      setBatchStatus(`¡Listo! Se añadieron ${count} entrada(s) correctamente.`);
      toast.success(`Se importaron ${count} archivos de conocimiento.`);
      setTimeout(() => setBatchStatus(null), 4000);
      load();
    } catch (e: any) {
      console.error("Error en importación:", e);
      toast.error("Error en la importación de archivos: " + (e?.message || e));
    } finally {
      setIsUploadingBatch(false);
      if (batchInputRef.current) batchInputRef.current.value = "";
    }
  }

  async function handleEditTextFileUpload(file: File) {
    try {
      const text = await file.text();
      if (!text || !text.trim()) {
        toast.error("El archivo de texto está vacío.");
        return;
      }
      setEditKbDraft((prev) => ({
        ...prev,
        content: text,
      }));
      setEditLoadedFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      sfx.pop();
      toast.success(`Contenido actualizado desde: ${file.name}`);
    } catch (e: any) {
      toast.error("Error al leer el archivo: " + (e?.message || e));
    }
  }

  async function handleBuildaFileUpload(file: File) {
    try {
      const text = await file.text();
      if (!text || !text.trim()) {
        toast.error("El archivo está vacío.");
        return;
      }
      const rawName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
      setNewBuilda((prev) => ({
        title: prev.title.trim() ? prev.title : rawName,
        description: prev.description,
        code: text,
      }));
      setBuildaFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
      sfx.pop();
      toast.success(`Script cargado: ${file.name}`);
    } catch (e: any) {
      toast.error("Error al leer script: " + (e?.message || e));
    }
  }

  async function addKb() {
    if (!newKb.title || !newKb.content) return;
    sfx.tap();
    try {
      await addDoc(collection(db, "orion_knowledge"), {
        ...newKb,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setNewKb({ title: "", content: "" });
      setLoadedFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success("Entrada de conocimiento añadida.");
      load();
    } catch (e: any) {
      toast.error("Error al añadir entrada: " + e.message);
    }
  }

  async function delKb(id: string) {
    sfx.tap();
    try {
      await deleteDoc(doc(db, "orion_knowledge", id));
      toast.success("Entrada eliminada.");
      load();
    } catch (e: any) {
      toast.error("Error al eliminar entrada: " + e.message);
    }
  }

  function startEditKb(k: KB) {
    setEditKbId(k.id);
    setEditKbDraft({ title: k.title, content: k.content });
    setEditLoadedFileName(null);
  }

  async function saveEditKb() {
    if (!editKbId) return;
    sfx.tap();
    try {
      await updateDoc(doc(db, "orion_knowledge", editKbId), {
        title: editKbDraft.title,
        content: editKbDraft.content,
        updatedAt: new Date().toISOString(),
      });
      setEditKbId(null);
      setEditLoadedFileName(null);
      toast.success("Entrada de conocimiento actualizada.");
      load();
    } catch (e: any) {
      toast.error("Error al actualizar: " + e.message);
    }
  }

  async function addRef(file: File) {
    if (!newRefName) {
      toast.error("Por favor ingresa un nombre para la referencia.");
      return;
    }
    sfx.tap();
    try {
      const url = await uploadAttachment(file);
      await addDoc(collection(db, "orion_reference_images"), {
        name: newRefName,
        url,
        description: newRefDesc,
        createdAt: new Date().toISOString(),
      });
      setNewRefName("");
      setNewRefDesc("");
      toast.success("Imagen de referencia guardada.");
      load();
    } catch (e: any) {
      toast.error("Error al guardar referencia: " + e.message);
    }
  }

  async function delRef(id: string) {
    sfx.tap();
    try {
      await deleteDoc(doc(db, "orion_reference_images", id));
      toast.success("Imagen de referencia eliminada.");
      load();
    } catch (e: any) {
      toast.error("Error al eliminar referencia: " + e.message);
    }
  }

  async function addBuilda() {
    if (!newBuilda.title.trim() || !newBuilda.code.trim()) return;
    sfx.tap();
    try {
      await addDoc(collection(db, "orion_builda_scripts"), {
        ...newBuilda,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setNewBuilda({ title: "", description: "", code: "" });
      setBuildaFileName(null);
      if (buildaFileInputRef.current) buildaFileInputRef.current.value = "";
      toast.success("Script de Builda guardado.");
      load();
    } catch (e: any) {
      toast.error("Error al guardar script: " + e.message);
    }
  }

  async function delBuilda(id: string) {
    sfx.tap();
    try {
      await deleteDoc(doc(db, "orion_builda_scripts", id));
      toast.success("Script eliminado.");
      load();
    } catch (e: any) {
      toast.error("Error al eliminar script: " + e.message);
    }
  }

  function startEditBuilda(b: Builda) {
    setEditBuildaId(b.id);
    setEditBuildaDraft({ title: b.title, description: b.description || "", code: b.code });
  }

  async function saveEditBuilda() {
    if (!editBuildaId) return;
    sfx.tap();
    try {
      await updateDoc(doc(db, "orion_builda_scripts", editBuildaId), {
        ...editBuildaDraft,
        updatedAt: new Date().toISOString(),
      });
      setEditBuildaId(null);
      toast.success("Script actualizado.");
      load();
    } catch (e: any) {
      toast.error("Error al actualizar script: " + e.message);
    }
  }

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-md animate-fade-up"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong w-full max-w-3xl h-[85vh] rounded-3xl shadow-glow border border-border flex flex-col overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">Acceso de administración</div>
            <div className="text-lg font-semibold tracking-tight">Panel de Control · Orión Estellar</div>
          </div>
          <button onClick={onClose} className="tap p-2 rounded-lg hover:bg-accent cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 pt-3 flex gap-2 flex-wrap">
          {[
            ["config", "Comportamiento"],
            ["kb", "Conocimiento"],
            ["refs", "Imágenes"],
            ["builda", "Scripts (Builda)"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => {
                sfx.tap();
                setTab(k as any);
              }}
              className={`tap px-3.5 py-1.5 rounded-full text-xs font-medium border cursor-pointer ${
                tab === k
                  ? "bg-primary text-primary-foreground border-transparent shadow-soft"
                  : "bg-card border-border hover:bg-accent text-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "config" && cfg && (
            <div className="space-y-4">
              {(["context", "personality", "behavior"] as const).map((k) => (
                <div key={k}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                    {k === "context" ? "Contexto del sistema" : k === "personality" ? "Personalidad" : "Comportamiento"}
                  </div>
                  <textarea
                    value={cfg[k] || ""}
                    onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                    rows={5}
                    className="w-full p-3 rounded-xl bg-card border border-border outline-none focus:border-ring text-sm"
                  />
                </div>
              ))}
              <button
                onClick={saveCfg}
                className="tap px-4 py-2 rounded-xl gradient-orion text-primary-foreground text-sm font-medium flex items-center gap-2 cursor-pointer shadow-soft"
              >
                <Save className="w-4 h-4" /> Guardar cambios en Firestore
              </button>
            </div>
          )}

          {tab === "kb" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingKb(true);
                }}
                onDragLeave={() => setIsDraggingKb(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingKb(false);
                  if (e.dataTransfer.files?.length) {
                    if (e.dataTransfer.files.length === 1) {
                      handleTextFileUpload(e.dataTransfer.files[0]);
                    } else {
                      handleBatchTextFiles(e.dataTransfer.files);
                    }
                  }
                }}
                className={`rounded-2xl bg-card border transition-all p-4 space-y-3 ${
                  isDraggingKb
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20 scale-[1.01]"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-primary" />
                    <span>Nueva entrada de conocimiento</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.text,.md,.markdown,.json,.csv,.log,.yaml,.yml,.xml,.ini,.cfg,text/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleTextFileUpload(e.target.files[0])}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="tap inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium cursor-pointer border border-primary/20 transition-colors"
                      title="Sube un archivo de texto para rellenar automáticamente el título y contenido de la entrada"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Subir archivo .txt</span>
                    </button>

                    <input
                      ref={batchInputRef}
                      type="file"
                      multiple
                      accept=".txt,.text,.md,.markdown,.json,.csv,.log,.yaml,.yml,.xml,.ini,.cfg,text/*"
                      className="hidden"
                      onChange={(e) => e.target.files && handleBatchTextFiles(e.target.files)}
                    />
                    <button
                      type="button"
                      disabled={isUploadingBatch}
                      onClick={() => batchInputRef.current?.click()}
                      className="tap inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card hover:bg-accent text-muted-foreground hover:text-foreground text-xs font-medium cursor-pointer border border-border transition-colors disabled:opacity-50"
                      title="Importa varios archivos de texto creando una entrada para cada uno"
                    >
                      {isUploadingBatch ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Files className="w-3.5 h-3.5" />
                      )}
                      <span>Importar múltiples archivos</span>
                    </button>
                  </div>
                </div>

                {batchStatus && (
                  <div className="flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg bg-primary/10 text-primary border border-primary/20 animate-fade-in">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{batchStatus}</span>
                  </div>
                )}

                {loadedFileName && (
                  <div className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-muted border border-border text-foreground">
                    <div className="flex items-center gap-2 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">
                        Contenido cargado desde: <strong>{loadedFileName}</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLoadedFileName(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <input
                  placeholder="Título de la entrada"
                  value={newKb.title}
                  onChange={(e) => setNewKb({ ...newKb, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm border border-border/40 focus:border-ring transition-colors"
                />

                <div className="space-y-1">
                  <textarea
                    placeholder="Contenido de la entrada (puedes escribirlo o subir un archivo .txt, .md, etc.)"
                    value={newKb.content}
                    onChange={(e) => setNewKb({ ...newKb, content: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg bg-muted outline-none resize-y text-sm border border-border/40 focus:border-ring font-mono text-xs transition-colors"
                  />
                  <div className="flex justify-between items-center text-[11px] text-muted-foreground px-1">
                    <span>Arrastra archivos .txt o usa el botón superior para cargar contenido</span>
                    <span>
                      {newKb.content.length.toLocaleString()} caracteres ·{" "}
                      {newKb.content ? newKb.content.split("\n").length : 0} líneas
                    </span>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={addKb}
                    disabled={!newKb.title.trim() || !newKb.content.trim()}
                    className="tap px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-1.5 cursor-pointer font-medium shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" /> Añadir entrada
                  </button>
                </div>
              </div>

              {kb.map((k) => (
                <div key={k.id} className="rounded-xl bg-card border border-border p-4 shadow-soft">
                  {editKbId === k.id ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-muted-foreground">Editar entrada</div>
                        <div>
                          <input
                            ref={editFileInputRef}
                            type="file"
                            accept=".txt,.text,.md,.markdown,.json,.csv,.log,.yaml,.yml,.xml,.ini,.cfg,text/*"
                            className="hidden"
                            onChange={(e) =>
                              e.target.files?.[0] && handleEditTextFileUpload(e.target.files[0])
                            }
                          />
                          <button
                            type="button"
                            onClick={() => editFileInputRef.current?.click()}
                            className="tap inline-flex items-center gap-1 px-2 py-1 rounded bg-muted hover:bg-accent text-xs cursor-pointer border border-border"
                          >
                            <FileUp className="w-3 h-3 text-primary" />
                            <span>Cargar archivo .txt al contenido</span>
                          </button>
                        </div>
                      </div>

                      {editLoadedFileName && (
                        <div className="text-xs py-1 px-2.5 rounded bg-muted text-emerald-500 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Archivo cargado: {editLoadedFileName}</span>
                        </div>
                      )}

                      <input
                        value={editKbDraft.title}
                        onChange={(e) => setEditKbDraft({ ...editKbDraft, title: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-muted outline-none font-semibold text-sm"
                      />
                      <textarea
                        value={editKbDraft.content}
                        onChange={(e) => setEditKbDraft({ ...editKbDraft, content: e.target.value })}
                        rows={7}
                        className="w-full px-3 py-2 rounded-lg bg-muted outline-none resize-y text-xs font-mono"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEditKb}
                          className="tap px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs flex items-center gap-1 cursor-pointer font-medium"
                        >
                          <Save className="w-3.5 h-3.5" /> Guardar cambios
                        </button>
                        <button
                          onClick={() => {
                            setEditKbId(null);
                            setEditLoadedFileName(null);
                          }}
                          className="tap px-3 py-1.5 rounded-lg bg-muted text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-semibold text-sm">{k.title}</div>
                        <div className="flex gap-1">
                          <button onClick={() => startEditKb(k)} className="p-1 hover:bg-accent rounded cursor-pointer">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => delKb(k.id)} className="text-destructive p-1 hover:bg-destructive/10 rounded cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1 leading-relaxed max-h-48 overflow-y-auto font-mono text-xs bg-muted/30 p-2.5 rounded-lg border border-border/40">
                        {k.content}
                      </p>
                    </>
                  )}
                </div>
              ))}
              {kb.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Base de conocimiento vacía</div>}
            </div>
          )}

          {tab === "refs" && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-card border border-border p-4 space-y-2">
                <input
                  placeholder="Nombre de la referencia"
                  value={newRefName}
                  onChange={(e) => setNewRefName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm"
                />
                <input
                  placeholder="Descripción (opcional)"
                  value={newRefDesc}
                  onChange={(e) => setNewRefDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm"
                />
                <label className="tap inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-primary text-primary-foreground text-sm cursor-pointer font-medium shadow-soft">
                  <Upload className="w-4 h-4" /> Subir imagen de referencia
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addRef(e.target.files[0])} />
                </label>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {refs.map((r) => (
                  <div key={r.id} className="rounded-xl bg-card border border-border overflow-hidden shadow-soft">
                    <img src={r.url} alt={r.name} className="w-full aspect-square object-cover" />
                    <div className="p-2">
                      <div className="text-xs font-semibold truncate">{r.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{r.description}</div>
                      <button onClick={() => delRef(r.id)} className="text-destructive text-xs mt-1 flex items-center gap-1 cursor-pointer">
                        <Trash2 className="w-3 h-3" /> Eliminar
                      </button>
                    </div>
                  </div>
                ))}
                {refs.length === 0 && (
                  <div className="col-span-full text-center text-muted-foreground text-sm py-8 flex flex-col items-center gap-2">
                    <ImageIcon className="w-6 h-6" /> Sin imágenes de referencia
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === "builda" && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5" /> Scripts de Builda. Orión los usará como referencia canónica para generar código.
              </div>
              <div className="rounded-2xl bg-card border border-border p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-primary" />
                    <span>Nuevo script</span>
                  </div>
                  <div>
                    <input
                      ref={buildaFileInputRef}
                      type="file"
                      accept=".txt,.lua,.js,.ts,.py,.json,.builda,text/*"
                      className="hidden"
                      onChange={(e) =>
                        e.target.files?.[0] && handleBuildaFileUpload(e.target.files[0])
                      }
                    />
                    <button
                      type="button"
                      onClick={() => buildaFileInputRef.current?.click()}
                      className="tap inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium cursor-pointer border border-primary/20 transition-colors"
                      title="Cargar archivo de código o texto"
                    >
                      <FileUp className="w-3.5 h-3.5" />
                      <span>Cargar archivo de script</span>
                    </button>
                  </div>
                </div>

                {buildaFileName && (
                  <div className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-muted border border-border text-foreground">
                    <div className="flex items-center gap-2 truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">
                        Script cargado: <strong>{buildaFileName}</strong>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setBuildaFileName(null);
                        if (buildaFileInputRef.current) buildaFileInputRef.current.value = "";
                      }}
                      className="text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <input
                  placeholder="Título (ej: bucle de físicas, movimiento, inventario…)"
                  value={newBuilda.title}
                  onChange={(e) => setNewBuilda({ ...newBuilda, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm border border-border/40 focus:border-ring transition-colors"
                />
                <input
                  placeholder="Descripción breve (opcional)"
                  value={newBuilda.description}
                  onChange={(e) => setNewBuilda({ ...newBuilda, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm border border-border/40 focus:border-ring transition-colors"
                />
                <div className="space-y-1">
                  <textarea
                    placeholder="Código Builda o contenido del script…"
                    value={newBuilda.code}
                    onChange={(e) => setNewBuilda({ ...newBuilda, code: e.target.value })}
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg bg-muted outline-none resize-y font-mono text-xs border border-border/40 focus:border-ring transition-colors"
                  />
                  <div className="flex justify-end text-[11px] text-muted-foreground px-1">
                    <span>
                      {newBuilda.code.length.toLocaleString()} caracteres ·{" "}
                      {newBuilda.code ? newBuilda.code.split("\n").length : 0} líneas
                    </span>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={addBuilda}
                    disabled={!newBuilda.title.trim() || !newBuilda.code.trim()}
                    className="tap px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm flex items-center gap-1.5 cursor-pointer font-medium shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" /> Añadir script
                  </button>
                </div>
              </div>
              {builda.map((b) => (
                <div key={b.id} className="rounded-xl bg-card border border-border p-4 shadow-soft">
                  {editBuildaId === b.id ? (
                    <div className="space-y-2">
                      <input
                        value={editBuildaDraft.title}
                        onChange={(e) => setEditBuildaDraft({ ...editBuildaDraft, title: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-muted outline-none font-semibold text-sm"
                      />
                      <input
                        value={editBuildaDraft.description}
                        onChange={(e) => setEditBuildaDraft({ ...editBuildaDraft, description: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-muted outline-none text-sm"
                      />
                      <textarea
                        value={editBuildaDraft.code}
                        onChange={(e) => setEditBuildaDraft({ ...editBuildaDraft, code: e.target.value })}
                        rows={8}
                        className="w-full px-3 py-2 rounded-lg bg-muted outline-none resize-y font-mono text-xs"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEditBuilda}
                          className="tap px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" /> Guardar
                        </button>
                        <button
                          onClick={() => setEditBuildaId(null)}
                          className="tap px-3 py-1.5 rounded-lg bg-muted text-xs cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="font-semibold text-sm">{b.title}</div>
                          {b.description && <div className="text-xs text-muted-foreground">{b.description}</div>}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => startEditBuilda(b)} className="p-1 hover:bg-accent rounded cursor-pointer">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => delBuilda(b.id)} className="text-destructive p-1 hover:bg-destructive/10 rounded cursor-pointer">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <pre className="text-xs font-mono bg-muted rounded-lg p-3 mt-2 overflow-x-auto whitespace-pre">{b.code}</pre>
                    </>
                  )}
                </div>
              ))}
              {builda.length === 0 && <div className="text-center text-sm text-muted-foreground py-8">Sin scripts de Builda</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
