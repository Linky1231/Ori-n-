import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  fbSignOut,
  onAuthStateChanged,
  type User,
} from "@/lib/firebase";
import { doc, getDoc, setDoc, query, collection, where, getDocs, writeBatch } from "firebase/firestore";
import { getLocalDeviceId, setAccountScope } from "@/lib/device";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

type AuthValue = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  signInWithGoogle: async () => {},
  refreshProfile: async () => {},
});

/** Traspasa los chats/notas guardados por dispositivo a la cuenta recién iniciada. */
async function migrateDeviceData(userId: string) {
  const did = getLocalDeviceId();
  if (!did || did === userId || did === "ssr") return;
  const done = localStorage.getItem(`orion_migrated_${userId}`);
  if (done) return;

  try {
    const collectionsToMigrate = ["conversations", "notes", "note_folders", "user_memory"];
    for (const colName of collectionsToMigrate) {
      const q = query(collection(db, colName), where("deviceId", "==", did));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const batch = writeBatch(db);
        snap.docs.forEach((d) => {
          batch.update(d.ref, { deviceId: userId, userId });
        });
        await batch.commit();
      }
    }
    localStorage.setItem(`orion_migrated_${userId}`, "1");
  } catch (e) {
    console.warn("Device migration skipped:", e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string, currentUser?: User | null) => {
    try {
      const pDoc = await getDoc(doc(db, "profiles", uid));
      if (pDoc.exists()) {
        const data = pDoc.data();
        setProfile({
          id: uid,
          display_name: data.displayName || data.display_name || "Usuario",
          avatar_url: data.avatarUrl || data.avatar_url || null,
        });
      } else if (currentUser) {
        // Create initial profile
        const newProf: Profile = {
          id: uid,
          display_name: currentUser.displayName || (currentUser.email ? currentUser.email.split("@")[0] : "Creador"),
          avatar_url: currentUser.photoURL || null,
        };
        await setDoc(doc(db, "profiles", uid), {
          displayName: newProf.display_name,
          avatarUrl: newProf.avatar_url,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        setProfile(newProf);
      }
    } catch (e) {
      console.warn("Could not load profile:", e);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u && u.isAnonymous) {
        // Disallow anonymous / guest mode per user request
        try {
          await fbSignOut(auth);
        } catch {}
        setUser(null);
        setAccountScope(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      setUser(u);
      setAccountScope(u?.uid ?? null);
      if (u) {
        const uid = u.uid;
        void migrateDeviceData(uid).then(() => loadProfile(uid, u));
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await fbSignOut(auth);
    setAccountScope(null);
    setProfile(null);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const res = await signInWithPopup(auth, googleProvider);
    if (res?.user) {
      setAccountScope(res.user.uid);
      try {
        await loadProfile(res.user.uid, res.user);
      } catch (err) {
        console.warn("Could not immediately sync profile on login:", err);
      }
    }
  }, [loadProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.uid, user);
  }, [user, loadProfile]);

  return (
    <Ctx.Provider
      value={{
        user,
        profile,
        loading,
        signOut,
        signInWithGoogle,
        refreshProfile,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
