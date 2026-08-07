"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CircuitPairDetail } from "@/lib/circuitPairSync";
import { applySyncFromTrunk, applySyncFromDevice } from "@/lib/circuitPairSync";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Panel dùng CHUNG (yêu cầu người dùng 2026-08-02: "kiểm tra 01 luồng" phải
// so đúng 3 điểm dữ liệu theo ánh xạ vật lý, không phải chỉ so tên rồi mới
// xét tiếp) — dùng ở CẢ 2 nơi: tab bứn "Đồng bộ Thiết bị-Trung kế" /
// "Đã liên kết nhưng lệch dữ liệu" (data-quality) LẪN nút "Kiểm tra đồng bộ"
// ngay trong form sửa 1 luồng (PortTable.tsx/DeviceCircuitList.tsx).
//
// Chọn 1 bên làm chuẩn (radio, bắt buộc chọn mới bấm "Áp dụng" được — cùng
// tinh thần tick-xác-nhận-trước-khi-sửa các tab trước) rồi đẩy ĐỦ 3 điểm dữ
// liệu theo đúng ánh xạ (xem lib/circuitPairSync.ts), KHÔNG chỉ tên như bản
// cũ. Nếu cặp chưa liên kết, "Áp dụng" LUÔN gắn mirror_of_id.
export default function CircuitPairSyncPanel({ detail, onApplied }: { detail: CircuitPairDetail; onApplied?: () => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"trunk" | "device" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMismatch =
    !detail.nameMatch || detail.ownPositionMatch === false || detail.nextPositionMatch === false || detail.tribMatch === false;

  async function apply(source: "trunk" | "device") {
    setBusy(true);
    setError(null);
    try {
      if (source === "trunk") await applySyncFromTrunk(supabase, detail);
      else await applySyncFromDevice(supabase, detail);
      router.refresh();
      onApplied?.();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-xs">
      {error && <p className="mb-1 text-red-600">Lỗi: {error}</p>}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-slate-400">
            <th className="w-1/6 py-0.5 font-normal"> </th>
            <th className="py-0.5 font-normal">Bên thiết bị (Hồ sơ đấu nối)</th>
            <th className="w-1/6 py-0.5 font-normal"> </th>
            <th className="py-0.5 font-normal">Bên trung kế (Chuyển tiếp / vị trí port thật)</th>
          </tr>
        </thead>
        <tbody>
          <DiffRow label="Tên luồng" a={detail.deviceName} bLabel="Tên luồng" b={detail.trunkName} match={detail.nameMatch} />
          {/* Nhãn "Vị trí ODF (thiết bị)"/"Vị trí ODF (tiếp theo)" chỉ đúng
              nghĩa cho cột "Bên thiết bị" (a) — đó là 2 cột thật
              device_position_own/device_position_next. Cột "Bên trung kế" (b)
              lại là 2 khái niệm KHÁC của chính bên trung kế (không phải
              "thiết bị"/"tiếp theo"), nên có NHÃN RIÊNG (cột riêng, cùng kiểu
              cột nhãn bên trái) thay vì dùng chung nhãn cột a.
              THỨ TỰ 2 dòng dưới (người dùng xác nhận 2026-08-03, đã 1 lần làm
              ngược): "Vị trí ODF trung kế" (vị trí port THẬT của chính rack
              trung kế này, so với deviceNextPosition — nextPositionMatch)
              PHẢI đứng TRƯỚC "Vị trí chuyển tiếp" (giá trị đọc từ ô Chuyển
              tiếp, so với deviceOwnPosition — ownPositionMatch). */}
          <DiffRow
            label="Vị trí ODF (tiếp theo)"
            a={detail.deviceNextPosition ?? "(trống)"}
            bLabel="Vị trí ODF trung kế"
            b={detail.trunkOwnPositionCanonical}
            match={detail.nextPositionMatch}
          />
          <DiffRow
            label="Vị trí ODF (thiết bị)"
            a={detail.deviceOwnPosition ?? "(trống)"}
            bLabel="Vị trí chuyển tiếp"
            b={detail.trunkTransitOdfPart ?? "(Chuyển tiếp trống/chưa đúng dạng)"}
            match={detail.ownPositionMatch}
          />
          <DiffRow
            label="Trib"
            a={detail.deviceTrib ?? "(trống)"}
            bLabel="Trib"
            b={detail.trunkTransitTrib ?? "(Chuyển tiếp trống/chưa đúng dạng)"}
            match={detail.tribMatch}
          />
        </tbody>
      </table>

      {hasMismatch ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1">
            <input type="radio" name={`side-${detail.trunkCircuitId}`} checked={choice === "trunk"} onChange={() => setChoice("trunk")} />
            Trung kế đúng — đẩy sang thiết bị
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name={`side-${detail.trunkCircuitId}`} checked={choice === "device"} onChange={() => setChoice("device")} />
            Thiết bị đúng — đẩy sang trung kế
          </label>
          <button
            type="button"
            className="btn-secondary px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!choice || busy}
            onClick={() => choice && apply(choice)}
          >
            {busy ? "Đang đồng bộ..." : "Áp dụng đồng bộ"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 text-emerald-700">
          <span>✓ Khớp đúng cả 3 điểm dữ liệu.</span>
          {!detail.isLinked && (
            <button
              type="button"
              className="btn-secondary px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy}
              onClick={() => apply("trunk")}
              title="Dữ liệu 2 bên đã khớp — chỉ cần gắn liên kết, không đổi gì"
            >
              {busy ? "Đang liên kết..." : "Liên kết (giữ nguyên dữ liệu)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DiffRow({
  label,
  a,
  bLabel,
  b,
  match,
}: {
  label: string;
  a: string;
  bLabel: string;
  b: string;
  match: boolean | null;
}) {
  const color = match === false ? "text-red-700 bg-red-50" : match === true ? "text-emerald-700" : "text-slate-400";
  return (
    <tr className={color}>
      <td className="py-0.5 pr-2 align-top text-slate-500">{label}</td>
      <td className="py-0.5 pr-2 align-top break-words">{a}</td>
      <td className="py-0.5 pr-2 align-top text-slate-500">{bLabel}</td>
      <td className="py-0.5 align-top break-words">{b}</td>
    </tr>
  );
}
