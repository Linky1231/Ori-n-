import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { OrionLogo } from "./OrionLogo";
import { Loader2 } from "lucide-react";
import { sfx } from "@/lib/sounds";

export function AuthScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleGoogle() {
    setErr(null);
    setBusy(true);
    sfx.tap();
    try {
      await signInWithGoogle();
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        // User closed or dismissed the popup window - normal user action, not an error
        setErr("Inicio de sesión cancelado. Haz clic de nuevo en 'Continuar con Google' para identificarte.");
      } else if (code === "auth/popup-blocked") {
        setErr("La ventana emergente fue bloqueada por el navegador. Por favor permite las ventanas emergentes para este sitio.");
      } else if (code === "auth/unauthorized-domain") {
        setErr("Este dominio no está autorizado en Firebase Authentication.");
      } else {
        setErr("No se pudo iniciar sesión con Google. Por favor, inténtalo de nuevo.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 relative">
      <div className="w-full max-w-sm liquid-glass rounded-3xl p-7 space-y-6 shadow-glow">
        <div className="flex flex-col items-center gap-3 text-center">
          <OrionLogo size={64} glow />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gradient-orion">Orión Estellar</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Asistente de IA para creadores y desarrolladores de videojuegos
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={busy}
            className="w-full h-12 rounded-xl liquid-glass flex items-center justify-center gap-2.5 text-sm font-medium transition-transform active:scale-[0.97] hover:brightness-110 disabled:opacity-60 cursor-pointer shadow-soft"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.3 17.6 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
                <path fill="#FBBC05" d="M10.4 28.7a14.6 14.6 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z" />
                <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.1-5.5c-2 1.4-4.6 2.2-8.2 2.2-6.4 0-11.7-3.8-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
            )}
            Continuar con Google
          </button>
        </div>

        {err && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive text-center leading-relaxed animate-fade-in">
            {err}
          </div>
        )}
      </div>
    </div>
  );
}
