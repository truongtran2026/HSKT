"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { formatRackCodeDisplay } from "@/lib/rackCode";
import { translatePgError } from "@/lib/translatePgError";
import RoleGate from "@/components/ui/RoleGate";

export interface RackHeaderData {
  id: string;
  code: string;
  cableRouteName: string | null;
  odfType: "welded" | "distribution";
  portCount: number;
}

export default function RackHeader({ rack }: { rack: RackHeaderData }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [routeName, setRouteName] = useState(rack.cableRouteName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("racks").update({ cable_route_name: routeName.trim() || null }).eq("id", rack.id);
    setBusy(false);
    if (err) {
      setError(translatePgError(err.message));
      return;
    }
    setEditing(false);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">{formatRackCodeDisplay(rack.code)}</h1>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="input max-w-md" value={routeName} onChange={(e) => setRouteName(e.target.value)} autoFocus />
          <button className="btn-primary" onClick={save} disabled={busy}>
            Lưu
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              setEditing(false);
              setRouteName(rack.cableRouteName ?? "");
              setError(null);
            }}
            disabled={busy}
          >
            Hủy
          </button>
        </div>
      ) : (
        <p className="text-slate-500 mt-1">
          {rack.cableRouteName} · {rack.odfType === "welded" ? "Hàn nối" : "Phân phối"} · {rack.portCount} port{" "}
          <RoleGate allow={["operator", "admin"]}>
            <button className="ml-1 text-primary-600 hover:underline text-sm" onClick={() => setEditing(true)}>
              Sửa tên tuyến
            </button>
          </RoleGate>
        </p>
      )}
      {error && <p className="text-sm text-red-600 mt-1">Lỗi: {error}</p>}
    </div>
  );
}
