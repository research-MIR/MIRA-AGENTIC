import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const SessionContext = createContext<{
  session: any;
  supabase: SupabaseClient<any, "public", any>;
  isProMode: boolean;
  toggleProMode: () => void;
}>({
  session: null,
  supabase: supabase,
  isProMode: false,
  toggleProMode: () => {},
});

export const SessionContextProvider = (props: any) => {
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProMode, setIsProMode] = useState(false);

  useEffect(() => {
    const getSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      setLoading(false);
    };

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const toggleProMode = useCallback(() => {
    setIsProMode(prev => !prev);
  }, []);

  const value = {
    session,
    supabase,
    isProMode,
    toggleProMode,
  };

  return (
    <SessionContext.Provider value={value}>
      {!loading && props.children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionContextProvider.");
  }
  return context;
};