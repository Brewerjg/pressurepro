import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import { cn } from "@/lib/utils";

// Crew CRUD — backed by public.crews. Color-codes teams so the schedule shows
// who's doing what at a glance (mirrors PressurePro's CrewManager behavior,
// retheme'd from navy/yellow to green/bronze).

type Crew = Database["public"]["Tables"]["crews"]["Row"];

const CREW_COLORS = [
  "#1f7a44", // green-800
  "#b08236", // bronze-600
  "#3b6fb0", // blue
  "#a23c5b", // wine
  "#5b6b3a", // olive
  "#7a4b1f", // brown
  "#3a6b6b", // teal
  "#6b3a6b", // purple
];

export default function CrewEditor() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CREW_COLORS[0]);

  const { data: crews, isLoading } = useQuery({
    queryKey: ["crews", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crews")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Crew[];
    },
  });

  const addMutation = useMutation({
    mutationFn: async (input: { name: string; color: string }) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("crews").insert({
        user_id: user.id,
        name: input.name,
        color: input.color,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crews", user?.id] });
      setNewName("");
      // Cycle palette for the next add.
      const idx = CREW_COLORS.indexOf(newColor);
      setNewColor(CREW_COLORS[(idx + 1) % CREW_COLORS.length]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<Crew, "name" | "color">>;
    }) => {
      const { error } = await supabase
        .from("crews")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crews", user?.id] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crews").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crews", user?.id] });
    },
  });

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    addMutation.mutate({ name: trimmed, color: newColor });
  };

  const handleDelete = (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete "${name}"? Assigned jobs will become unassigned.`,
      )
    )
      return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="tp-card p-4 space-y-3">
      <p className="text-[11px] text-neutral-500">
        Color-code teams so the schedule shows who's doing what at a glance.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading crews…
        </div>
      ) : crews && crews.length > 0 ? (
        <ul className="space-y-2">
          {crews.map((c) => (
            <CrewRow
              key={c.id}
              crew={c}
              onPatch={(patch) =>
                updateMutation.mutate({ id: c.id, patch })
              }
              onDelete={() => handleDelete(c.id, c.name)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-neutral-500">
          No crews yet. Add one below.
        </p>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          className="h-9 w-9 rounded-lg border border-neutral-200 cursor-pointer p-0.5 bg-card"
          aria-label="New crew color"
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !addMutation.isPending) handleAdd();
          }}
          placeholder="Crew name (e.g. East Side, Tom + Mike)"
          className="flex-1 h-9 rounded-lg border border-neutral-200 px-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-700/30 focus:border-brand-700"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={addMutation.isPending || !newName.trim()}
          className={cn(
            "h-9 px-3 rounded-lg bg-brand-800 text-white text-[13px] font-semibold flex items-center gap-1 disabled:opacity-50 hover:bg-brand-900 transition-colors",
          )}
        >
          {addMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add
        </button>
      </div>

      {(addMutation.isError ||
        updateMutation.isError ||
        deleteMutation.isError) && (
        <p className="text-[11px] font-semibold text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Couldn't sync change.
        </p>
      )}
    </div>
  );
}

function CrewRow({
  crew,
  onPatch,
  onDelete,
}: {
  crew: Crew;
  onPatch: (patch: Partial<Pick<Crew, "name" | "color">>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(crew.name);
  const [color, setColor] = useState(crew.color);

  return (
    <li className="flex items-center gap-2">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        onBlur={() => {
          if (color !== crew.color) onPatch({ color });
        }}
        className="h-9 w-9 rounded-lg border border-neutral-200 cursor-pointer p-0.5 bg-card"
        aria-label={`${crew.name} color`}
      />
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (!trimmed) {
            setName(crew.name);
            return;
          }
          if (trimmed !== crew.name) onPatch({ name: trimmed });
        }}
        className="flex-1 h-9 rounded-lg border border-neutral-200 px-3 text-sm font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-700/30 focus:border-brand-700"
      />
      <button
        type="button"
        onClick={onDelete}
        className="h-9 w-9 rounded-lg text-destructive hover:bg-[hsl(var(--destructive-bg))] flex items-center justify-center"
        aria-label={`Delete ${crew.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}
