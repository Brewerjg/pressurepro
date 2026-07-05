import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export default function SignOut() {
  const navigate = useNavigate();

  useEffect(() => {
    const signOut = async () => {
      await supabase.auth.signOut();
      navigate("/auth", { replace: true });
    };
    signOut();
  }, [navigate]);

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-4" />
        <p className="text-sm text-neutral-500">Signing out...</p>
      </div>
    </div>
  );
}