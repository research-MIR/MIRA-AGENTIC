import { createContext, useContext, useEffect, useState } from "react";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const SessionContext = createContext<{
  session: any;
  supabase: SupabaseClient<any, "public", any>;
}>({
  session: null,
  supabase: supabase,
});

export const SessionContextProvider = (props: any) => {
  const [session, setSession] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

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

  const value = {
    session,
    supabase,
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