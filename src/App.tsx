import { AuthProvider, useAuth } from "@/lib/auth";
import { ChatApp } from "@/components/orion/ChatApp";
import { AuthScreen } from "@/components/orion/AuthScreen";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
      </div>
    );
  }

  return user ? <ChatApp /> : <AuthScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
      <Toaster position="bottom-right" />
    </AuthProvider>
  );
}
