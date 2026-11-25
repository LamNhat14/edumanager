import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, setSessionToken } from "./lib/api";
export type User = {
  id: string;
  username: string;
  display_name: string;
  status: "active" | "locked";
  must_change_password: boolean;
  version: number;
  roles: string[];
  permissions: string[];
};
const Context = createContext<{
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}>({
  user: null,
  login: async () => {},
  logout: async () => {},
  clear: () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const cache = useQueryClient();
  const clear = () => {
    setSessionToken(null);
    setUser(null);
    cache.clear();
  };
  useEffect(() => {
    window.addEventListener("auth-expired", clear);
    return () => window.removeEventListener("auth-expired", clear);
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      api<User>("/auth/me")
        .then(setUser)
        .catch(() => {});
    }, 60000);
    return () => clearInterval(timer);
  }, [user?.id]);
  const login = async (username: string, password: string) => {
    const data = await api<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    cache.clear();
    setSessionToken(data.token);
    setUser(data.user);
  };
  const logout = async () => {
    await api("/auth/logout", { method: "POST", body: "{}" });
    clear();
  };
  return (
    <Context.Provider value={{ user, login, logout, clear }}>
      {children}
    </Context.Provider>
  );
}
export const useAuth = () => useContext(Context);
