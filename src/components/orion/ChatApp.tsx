import { useEffect, useRef, useState, createContext, useContext, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { getDeviceId } from "@/lib/device";
import { sfx } from "@/lib/sounds";
import {
  streamChat,
  uploadAttachment,
  extractAndStoreMemory,
  createChatTitle,
  type ChatMsg,
} from "@/lib/orion-api";

import { OrionLogo } from "./OrionLogo";
import { Sidebar } from "./Sidebar";
import { NotesPanel } from "./NotesPanel";
import { MapsPanel } from "./MapsPanel";
import { DebugPanel } from "./DebugPanel";
import { AdminPanel } from "./AdminPanel";
import { LocationPlaceCard } from "./LocationPlaceCard";
import { toast } from "sonner";

import {
  Menu,
  Send,
  Paperclip,
  User,
  Copy,
  Volume2,
  Square,
  X,
  Trash2,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";

const SpeechCtx = createContext<{ speakingId: string | null; toggle: (id: string, text: string) => void }>({
  speakingId: null,
  toggle: () => {},
});

type DBMsg = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: any[];
  created_at: string;
};

const ADMIN_TOKEN = "Admin7880";

export function ChatApp() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<any>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const [isDeletingCurrentChat, setIsDeletingCurrentChat] = useState(false);

  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DBMsg[]>([]);
  const [recentConvs, setRecentConvs] = useState<{ id: string; title: string; updatedAt?: string }[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<{ url: string; type: string; name: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [messages, streaming]);

  // Load recent conversations to intelligently contextualize suggestions
  useEffect(() => {
    const did = getDeviceId();
    const qCol = query(collection(db, "conversations"), where("deviceId", "==", did));
    const unsubscribe = onSnapshot(
      qCol,
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            title: data.title || "Conversación",
            updatedAt: data.updatedAt || data.createdAt || "",
          };
        });
        list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        setRecentConvs(list);
      },
      (error) => {
        console.warn("Conversations listener error:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!convId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, "messages"),
      where("conversationId", "==", convId)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: DBMsg[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            conversation_id: data.conversationId,
            role: data.role,
            content: data.content,
            attachments: data.attachments || [],
            created_at: data.createdAt || new Date().toISOString(),
          };
        });
        list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setMessages(list);
      },
      (error) => {
        console.warn("Messages listener error:", error);
      }
    );

    return () => unsubscribe();
  }, [convId]);

  async function ensureConv(firstText: string): Promise<string> {
    if (convId) return convId;
    const did = getDeviceId();
    const title = await createChatTitle(firstText);
    const docRef = await addDoc(collection(db, "conversations"), {
      deviceId: did,
      title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setConvId(docRef.id);
    return docRef.id;
  }

  async function send(overrideText?: string) {
    if (streaming) return;
    const text = (overrideText ?? input).trim();
    if (!text && pending.length === 0) return;

    // Admin trigger
    if (text === ADMIN_TOKEN) {
      sfx.open();
      setAdminOpen(true);
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      return;
    }

    sfx.send();
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    const atts = pending;
    setPending([]);

    const id = await ensureConv(text);

    // Save user message in Firestore
    const userMsg = {
      conversationId: id,
      role: "user" as const,
      content: text,
      attachments: atts,
      createdAt: new Date().toISOString(),
    };
    await addDoc(collection(db, "messages"), userMsg);

    // Build chat history for AI (with multimodal content)
    const history: ChatMsg[] = messages
      .concat([
        {
          id: "temp-user",
          conversation_id: id,
          role: "user",
          content: text,
          attachments: atts,
          created_at: new Date().toISOString(),
        },
      ])
      .map((m) => {
        const imgs = (m.attachments || []).filter((a: any) => a.type?.startsWith("image"));
        const vids = (m.attachments || []).filter((a: any) => a.type?.startsWith("video"));
        if (m.role === "user" && (imgs.length || vids.length)) {
          return {
            role: "user",
            content: [
              {
                type: "text",
                text: m.content || "Analiza el contenido adjunto y descríbelo con detalle.",
              },
              ...imgs.map((a: any) => ({ type: "image_url", image_url: { url: a.url } })),
              ...vids.map((a: any) => ({ type: "video_url", video_url: { url: a.url } })),
            ] as any,
          };
        }
        return { role: m.role, content: m.content };
      });

    // Stream assistant response
    setStreaming(true);
    let acc = "";
    let receivedAttachments: { url: string; type: string; name: string }[] = [];
    const tempId = "tmp-" + Date.now();
    setMessages((m) => [
      ...m,
      {
        id: tempId,
        conversation_id: id,
        role: "assistant",
        content: "",
        attachments: [],
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const onDelta = (delta: string) => {
        acc += delta;
        setMessages((m) =>
          m.map((x) =>
            x.id === tempId ? { ...x, content: acc, attachments: [...receivedAttachments] } : x
          )
        );
      };

      const onAttachment = (att: { url: string; type: string; name: string }) => {
        receivedAttachments = [...receivedAttachments, att];
        setMessages((m) =>
          m.map((x) =>
            x.id === tempId ? { ...x, attachments: [...receivedAttachments] } : x
          )
        );
      };

      await streamChat(history, onDelta, undefined, onAttachment);

      await addDoc(collection(db, "messages"), {
        conversationId: id,
        role: "assistant",
        content: acc,
        attachments: receivedAttachments,
        createdAt: new Date().toISOString(),
      });
      sfx.receive();
      await updateDoc(doc(db, "conversations", id), {
        updatedAt: new Date().toISOString(),
      });
      window.setTimeout(() => extractAndStoreMemory(text), 2500);
    } catch (e: any) {
      sfx.error();
      setMessages((m) =>
        m.map((x) => (x.id === tempId ? { ...x, content: "Error: " + e.message } : x))
      );
    }
    setStreaming(false);
  }

  async function onFile(f: File) {
    sfx.tap();
    if (f.size > 25 * 1024 * 1024) {
      sfx.error();
      toast.error("El archivo es muy grande (máx. 25 MB).");
      return;
    }
    try {
      const url = await uploadAttachment(f);
      setPending((p) => [...p, { url, type: f.type, name: f.name }]);
      toast.success(`Archivo adjuntado: ${f.name}`);
    } catch (e: any) {
      sfx.error();
      toast.error(e?.message || "Error al subir el archivo.");
    }
  }

  function newConv() {
    setConvId(null);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function deleteCurrentChat() {
    if (!convId) return;
    setIsDeletingCurrentChat(true);
    sfx.tap();
    try {
      await deleteDoc(doc(db, "conversations", convId));
      const msgsQ = query(collection(db, "messages"), where("conversationId", "==", convId));
      const mSnap = await getDocs(msgsQ);
      await Promise.all(mSnap.docs.map((m) => deleteDoc(m.ref)));
      toast.success("Conversación eliminada.");
    } catch (e: any) {
      console.warn("Delete active conversation error:", e);
      toast.error("Error al eliminar la conversación.");
    } finally {
      setIsDeletingCurrentChat(false);
    }
    newConv();
  }

  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const toggleSpeak = useCallback(
    (id: string, text: string) => {
      sfx.tap();
      if (speakingId === id) {
        window.speechSynthesis.cancel();
        setSpeakingId(null);
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES";
      u.onend = () => setSpeakingId((cur) => (cur === id ? null : cur));
      u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur));
      window.speechSynthesis.speak(u);
      setSpeakingId(id);
    },
    [speakingId]
  );

  useEffect(() => () => window.speechSynthesis.cancel(), []);

  return (
    <SpeechCtx.Provider value={{ speakingId, toggle: toggleSpeak }}>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          currentId={convId}
          onSelect={setConvId}
          onNew={newConv}
          onOpenNotes={() => setNotesOpen(true)}
          onOpenDebug={() => setDebugOpen(true)}
          onCreateImage={() => {
            newConv();
            setInput("Genera una imagen de ");
            setSidebarOpen(false);
          }}
        />

        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="liquid-glass border-b border-border px-4 py-3 flex items-center gap-3 rounded-none">
            <button
              className="tap btn-glass p-2 rounded-xl md:hidden cursor-pointer"
              onClick={() => {
                sfx.tap();
                setSidebarOpen(true);
              }}
              title="Abrir menú"
            >
              <Menu className="w-5 h-5" />
            </button>
            <button
              className="tap btn-glass hidden md:flex p-2 rounded-xl cursor-pointer"
              onClick={() => {
                sfx.tap();
                setSidebarOpen((v) => !v);
              }}
              title="Alternar barra lateral"
            >
              <Menu className="w-5 h-5" />
            </button>
            <OrionLogo size={36} glow={streaming} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold tracking-tight leading-tight">Orión Estellar</div>
              <div className="text-[11px] text-muted-foreground">v5.0 · por Linky</div>
            </div>

            <div className="flex items-center gap-2">
              {convId && (
                <button
                  onClick={() => setShowDeleteChatModal(true)}
                  className="tap btn-glass p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  title="Eliminar esta conversación"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </header>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden px-3 sm:px-4 py-6">
            <div className="max-w-3xl mx-auto space-y-5 w-full min-w-0">
              {messages.length === 0 && <Welcome />}
              {messages.map((m) => (
                <Bubble
                  key={m.id}
                  m={m}
                  onOpenNotes={() => setNotesOpen(true)}
                  onOpenMapModal={(loc) => {
                    setSelectedPlace(loc);
                    setMapsOpen(true);
                  }}
                />
              ))}
              {streaming &&
                (() => {
                  const last = messages[messages.length - 1];
                  return !last || last.role !== "assistant" || !last.content?.trim();
                })() && <ThinkingIndicator />}
            </div>
          </div>

          {/* Composer */}
          <div className="px-4 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
              {pending.length > 0 && (
                <div className="flex gap-2 mb-2 flex-wrap">
                  {pending.map((p, i) => (
                    <div
                      key={i}
                      className="relative bg-card border border-border rounded-xl p-1.5 pr-7 text-xs flex items-center gap-2"
                    >
                      {p.type.startsWith("image") ? (
                        <img src={p.url} className="w-8 h-8 rounded object-cover" />
                      ) : p.type.startsWith("video") ? (
                        <video src={p.url} className="w-8 h-8 rounded object-cover" muted />
                      ) : (
                        <Paperclip className="w-4 h-4" />
                      )}
                      <span className="max-w-[120px] truncate">{p.name}</span>
                      <button
                        className="absolute right-1 top-1 p-0.5 hover:bg-accent rounded cursor-pointer"
                        onClick={() => setPending(pending.filter((_, j) => j !== i))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="liquid-glass rounded-2xl p-2 flex items-end gap-1.5 shadow-soft">
                <button
                  onClick={() => {
                    sfx.tap();
                    fileRef.current?.click();
                  }}
                  className="tap btn-glass p-2.5 rounded-xl cursor-pointer shrink-0 text-muted-foreground hover:text-foreground transition"
                  title="Subir archivo o imagen"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/*,application/pdf,text/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach((f) => onFile(f));
                    e.target.value = "";
                  }}
                />
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Escribe un mensaje a Orión…"
                  rows={1}
                  className="flex-1 bg-transparent outline-none resize-none px-3 py-2 text-sm max-h-44 placeholder:text-muted-foreground leading-relaxed"
                />
                <button
                  onClick={() => send()}
                  disabled={streaming || (!input.trim() && pending.length === 0)}
                  className="tap btn-cosmic p-2.5 rounded-xl disabled:opacity-40 cursor-pointer shrink-0"
                  title="Enviar"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="text-[11px] text-center text-muted-foreground mt-2">
                Orión puede cometer errores. Considera verificar la información importante.
              </div>
            </div>
          </div>
        </main>

        <NotesPanel open={notesOpen} onClose={() => setNotesOpen(false)} />
        <MapsPanel
          open={mapsOpen}
          onClose={() => {
            setMapsOpen(false);
            setSelectedPlace(null);
          }}
          initialPlace={selectedPlace}
          onOpenNotes={() => setNotesOpen(true)}
        />
        <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
        <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
      </div>

      {/* Modal confirmación para eliminar chat actual */}
      {showDeleteChatModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-fade-in">
          <div className="liquid-glass border border-destructive/30 max-w-sm w-full p-5 rounded-2xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-destructive/15 text-destructive">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">¿Eliminar conversación?</h3>
                <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              ¿Estás seguro de que deseas eliminar este chat y todo su historial de mensajes?
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                disabled={isDeletingCurrentChat}
                onClick={() => setShowDeleteChatModal(false)}
                className="px-3.5 py-2 rounded-xl text-sm font-medium hover:bg-accent text-foreground transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                disabled={isDeletingCurrentChat}
                onClick={async () => {
                  await deleteCurrentChat();
                  setShowDeleteChatModal(false);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-destructive hover:bg-destructive/90 text-destructive-foreground transition cursor-pointer disabled:opacity-50"
              >
                {isDeletingCurrentChat && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Eliminar conversación
              </button>
            </div>
          </div>
        </div>
      )}
    </SpeechCtx.Provider>
  );
}

function Welcome() {
  return (
    <div className="flex flex-col items-center text-center pt-14 pb-8 animate-fade-up px-4">
      <div className="relative mb-2">
        <OrionLogo size={80} glow />
        <span className="absolute inset-0 rounded-full bg-primary/25 blur-2xl pointer-events-none" />
      </div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-3">
        <span className="text-gradient-orion">Orión Estellar</span>
      </h1>
      <p className="text-sm text-muted-foreground mt-2 max-w-md leading-relaxed">
        Tu asistente y copiloto para desarrollo y diseño de videojuegos. Escribe un mensaje para comenzar a diseñar mecánicas, arte conceptual o programar tus sistemas.
      </p>
    </div>
  );
}

function CodeBlock({ children, className }: { children: any; className?: string }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const codeText = String(children).replace(/\n$/, "");

  const copy = () => {
    navigator.clipboard.writeText(codeText);
    setCopied(true);
    sfx.tap();
    toast.success("Código copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-2.5 rounded-xl overflow-hidden border border-border bg-card/90 max-w-full min-w-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/60 border-b border-border/50 text-[11px] font-mono text-muted-foreground">
        <span className="uppercase text-[10px] tracking-wider font-semibold">{lang || "código"}</span>
        <button
          onClick={copy}
          className="tap flex items-center gap-1 hover:text-foreground cursor-pointer px-1.5 py-0.5 rounded hover:bg-card transition"
          title="Copiar código"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto max-w-full text-xs font-mono leading-relaxed bg-transparent !m-0 !border-0 scrollbar-thin">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Bubble({
  m,
  onOpenNotes,
  onOpenMapModal,
}: {
  m: DBMsg;
  onOpenNotes: () => void;
  onOpenMapModal?: (data: any) => void;
}) {
  const isUser = m.role === "user";
  const hasAttachments = (m.attachments || []).length > 0;
  if (!isUser && !m.content?.trim() && !hasAttachments) return null;
  return (
    <div className={`flex gap-3 animate-fade-up w-full min-w-0 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className="shrink-0">
        {isUser ? (
          <div className="w-8 h-8 rounded-full gradient-orion flex items-center justify-center text-primary-foreground shadow-soft">
            <User className="w-4 h-4" />
          </div>
        ) : (
          <OrionLogo size={32} />
        )}
      </div>
      <div className={`min-w-0 max-w-[88%] sm:max-w-[82%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1.5`}>
        {(m.attachments || []).map((a: any, i: number) => {
          if (a.type === "location/json") {
            let locData: any = null;
            try {
              locData = typeof a.name === "string" && a.name.startsWith("{") ? JSON.parse(a.name) : null;
            } catch {}
            return (
              <LocationPlaceCard
                key={i}
                data={locData}
                url={a.url}
                onOpenNotes={onOpenNotes}
                onOpenMapModal={onOpenMapModal}
              />
            );
          }
          if (a.type?.startsWith("image")) {
            return <GeneratedImage key={i} src={a.url} />;
          }
          if (a.type?.startsWith("video")) {
            return (
              <video
                key={i}
                src={a.url}
                controls
                playsInline
                className="rounded-2xl max-h-80 max-w-full border border-border shadow-soft"
              />
            );
          }
          return (
            <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-xs underline text-primary break-all max-w-full">
              {a.name}
            </a>
          );
        })}
        {m.content && (
          <div
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-soft min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word] ${
              isUser ? "btn-cosmic !rounded-2xl rounded-br-sm text-primary-foreground" : "liquid-glass rounded-bl-sm"
            }`}
          >
            {isUser ? (
              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] relative z-10">{m.content}</div>
            ) : (
              <div className="prose prose-sm max-w-full min-w-0 break-words [overflow-wrap:anywhere] [word-break:break-word] relative z-10">
                <ReactMarkdown
                  components={{
                    code({ inline, className, children, ...props }: any) {
                      if (inline) {
                        return (
                          <code className={`${className || ""} break-all`} {...props}>
                            {children}
                          </code>
                        );
                      }
                      return <CodeBlock className={className}>{children}</CodeBlock>;
                    },
                    table({ children }: any) {
                      return (
                        <div className="w-full max-w-full overflow-x-auto my-3 rounded-lg border border-border">
                          <table className="min-w-full text-xs">{children}</table>
                        </div>
                      );
                    },
                    pre({ children }: any) {
                      return <div className="max-w-full min-w-0 overflow-x-auto">{children}</div>;
                    },
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}
        {!isUser && m.content && (
          <div className="flex gap-1 opacity-60 hover:opacity-100 transition">
            <button
              onClick={() => {
                navigator.clipboard.writeText(m.content);
                sfx.tap();
                toast.success("Texto copiado al portapapeles");
              }}
              className="tap p-1 rounded hover:bg-accent cursor-pointer"
              title="Copiar respuesta"
            >
              <Copy className="w-3 h-3" />
            </button>
            <SpeakBtn id={m.id} text={m.content} />
          </div>
        )}
      </div>
    </div>
  );
}

function GeneratedImage({ src }: { src: string }) {
  const [url, setUrl] = useState(src);
  const [failed, setFailed] = useState(false);

  function retry() {
    setFailed(true);
  }

  if (failed) {
    return (
      <div className="liquid-glass rounded-2xl border border-border px-4 py-3 text-sm text-muted-foreground">
        La imagen no se pudo cargar. Puedes intentar generarla de nuevo.
      </div>
    );
  }

  return (
    <img
      src={url}
      alt="Imagen generada"
      onError={retry}
      className="rounded-2xl max-h-80 border border-border shadow-soft object-contain"
    />
  );
}

function SpeakBtn({ id, text }: { id: string; text: string }) {
  const { speakingId, toggle } = useContext(SpeechCtx);
  const active = speakingId === id;
  return (
    <button
      onClick={() => toggle(id, text)}
      className={`tap p-1 rounded hover:bg-accent cursor-pointer ${active ? "text-primary" : ""}`}
      title={active ? "Detener" : "Escuchar"}
    >
      {active ? <Square className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
    </button>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 animate-fade-in">
      <div className="relative">
        <OrionLogo size={28} glow />
        <span className="absolute inset-0 rounded-full bg-primary/30 blur-md animate-pulse" />
      </div>
      <div className="liquid-glass rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2 relative overflow-hidden">
        <span className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent -translate-x-full animate-[shimmer_1.8s_ease-in-out_infinite]" />
        <span className="relative w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms", animationDuration: "1s" }} />
        <span className="relative w-2 h-2 rounded-full bg-primary/80 animate-bounce" style={{ animationDelay: "150ms", animationDuration: "1s" }} />
        <span className="relative w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "300ms", animationDuration: "1s" }} />
        <span className="relative text-xs text-muted-foreground ml-1.5">Orión está pensando…</span>
      </div>
    </div>
  );
}
