"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import { deviceCategoryLabel } from "@/lib/devices";
import { normalizeVN } from "@/lib/text";
import FilterInput from "@/components/ui/FilterInput";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import type { DeviceRow } from "@/lib/devices";

interface RawVariant {
  text: string;
  count: number;
}

interface Group {
  key: string;
  variants: RawVariant[];
  circuits: DeviceCircuitRow[];
}

function buildGroups(circuits: DeviceCircuitRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const c of circuits) {
    if (!c.deviceName) continue;
    const raw = c.deviceName.trim();
    const key = normalizeDeviceNameKey(raw);
    let g = map.get(key);
    if (!g) {
      g = { key, variants: [], circuits: [] };
      map.set(key, g);
    }
    g.circuits.push(c);
    const v = g.variants.find((item) => item.text === raw);
    if (v) v.count += 1;
    else g.variants.push({ text: raw, count: 1 });
  }
  return [...map.values()];
}

function bestVariantText(g: Group): string {
  const sorted = [...g.variants].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
  return sorted[0]?.text ?? "";
}

// Cả nhóm coi là "đã chuẩn hóa" khi MỌI luồng trong nhóm cùng trỏ về đúng 1
// device_id (không phải chỉ có 1 luồng nào đó có device_id).
function isGroupDone(g: Group): boolean {
  const first = g.circuits[0]?.deviceId ?? null;
  return first !== null && g.circuits.every((c) => c.deviceId === first);
}

export default function DeviceStandardizeClient({
  circuits,
  initialDevices,
  stationId,
}: {
  circuits: DeviceCircuitRow[];
  initialDevices: DeviceRow[];
  stationId: string;
}) {
  const router = useRouter();
  const [devices, setDevices] = useState<DeviceRow[]>(initialDevices);
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const noDeviceNameCount = useMemo(() => circuits.filter((c) => !c.deviceName).length, [circuits]);

  const groups = useMemo(() => {
    const list = buildGroups(circuits);
    return list.sort((a, b) => {
      const aDone = isGroupDone(a);
      const bDone = isGroupDone(b);
      if (aDone !== bDone) return aDone ? 1 : -1; // chưa chuẩn hóa lên trước
      return b.circuits.length - a.circuits.length; // nhóm nhiều luồng hơn lên trước
    });
  }, [circuits]);

  const pendingCount = groups.filter((g) => !isGroupDone(g)).length;

  // Lĩnh vực của 1 nhóm: nhóm đã chuẩn hóa lấy category từ đúng devices row
  // đang gắn (migration devices.category); nhóm chưa chuẩn hóa thì chưa có
  // devices row nên chưa xác định được — rơi vào "Chưa phân loại".
  function groupCategory(g: Group): string {
    if (isGroupDone(g)) {
      const deviceId = g.circuits[0].deviceId!;
      const category = devices.find((d) => d.id === deviceId)?.category ?? null;
      return deviceCategoryLabel(category);
    }
    return deviceCategoryLabel(null);
  }

  // Lọc theo từ khóa (tên biến thể) rồi nhóm theo lĩnh vực để dễ chuẩn hóa
  // từng mảng thay vì cuộn 1 danh sách phẳng dài (~150 nhóm). Sắp xếp thứ tự
  // ưu tiên (chưa xong lên trước) vẫn giữ nguyên BÊN TRONG từng lĩnh vực.
  const searchedGroups = useMemo(() => {
    const q = normalizeVN(search.trim());
    if (!q) return groups;
    return groups.filter((g) => g.variants.some((v) => normalizeVN(v.text).includes(q)));
  }, [groups, search]);

  const categoryBuckets = useMemo(() => {
    const map = new Map<string, Group[]>();
    for (const g of searchedGroups) {
      const cat = groupCategory(g);
      const list = map.get(cat) ?? [];
      list.push(g);
      map.set(cat, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [searchedGroups, devices]);

  // Tên chuẩn ĐANG hiển thị cho 1 nhóm: nếu đã chuẩn hóa thì lấy đúng tên
  // devices.name hiện tại (để có thể sửa lại), chưa thì lấy biến thể phổ
  // biến nhất làm gợi ý mặc định.
  function currentCanonicalName(g: Group): string {
    if (isGroupDone(g)) {
      const deviceId = g.circuits[0].deviceId!;
      return devices.find((d) => d.id === deviceId)?.name ?? bestVariantText(g);
    }
    return bestVariantText(g);
  }

  // "Áp dụng" dùng chung cho 3 tình huống, phân biệt bằng trạng thái nhóm +
  // tên vừa gõ:
  // 1. Nhóm CHƯA chuẩn hóa -> tạo thiết bị mới (hoặc dùng lại nếu tên trùng
  //    thiết bị đã có) rồi gắn device_id cho toàn bộ luồng trong nhóm.
  // 2. Nhóm ĐÃ chuẩn hóa, gõ tên KHÔNG trùng ai khác -> chỉ đổi tên tại chỗ
  //    (rename), không cần động vào circuits vì device_id không đổi.
  // 3. Nhóm ĐÃ chuẩn hóa, gõ tên TRÙNG 1 thiết bị khác đã có -> gộp (merge):
  //    trỏ lại toàn bộ luồng trong nhóm sang thiết bị kia, dọn luôn dòng
  //    devices cũ nếu không còn luồng nào khác dùng tới.
  async function applyGroup(g: Group) {
    const canonicalName = (nameOverrides[g.key] ?? currentCanonicalName(g)).trim();
    if (!canonicalName) {
      setError("Tên thiết bị không được để trống.");
      return;
    }
    setBusyKey(`${g.key}:apply`);
    setError(null);
    try {
      const targetKey = normalizeDeviceNameKey(canonicalName);
      const currentDeviceId = isGroupDone(g) ? g.circuits[0].deviceId : null;
      const matchedOther = devices.find((d) => normalizeDeviceNameKey(d.name) === targetKey && d.id !== currentDeviceId);

      if (matchedOther) {
        const results = await Promise.all(
          g.circuits.map((c) => supabase.from("circuits").update({ device_id: matchedOther.id }).eq("id", c.id))
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);

        if (currentDeviceId && currentDeviceId !== matchedOther.id) {
          const stillUsedElsewhere = circuits.some(
            (c) => c.deviceId === currentDeviceId && !g.circuits.some((gc) => gc.id === c.id)
          );
          if (!stillUsedElsewhere) {
            await supabase.from("devices").delete().eq("id", currentDeviceId);
            setDevices((prev) => prev.filter((d) => d.id !== currentDeviceId));
          }
        }
      } else if (currentDeviceId) {
        const { error: updErr } = await supabase.from("devices").update({ name: canonicalName }).eq("id", currentDeviceId);
        if (updErr) throw new Error(updErr.message);
        setDevices((prev) => prev.map((d) => (d.id === currentDeviceId ? { ...d, name: canonicalName } : d)));
      } else {
        const { data, error: insErr } = await supabase
          .from("devices")
          .insert({ station_id: stationId, name: canonicalName, source: "auto" })
          .select("id, name, source, category")
          .single();
        if (insErr) throw new Error(insErr.message);
        const newDeviceId = data.id as string;
        setDevices((prev) => [...prev, data as DeviceRow]);
        const results = await Promise.all(
          g.circuits.map((c) => supabase.from("circuits").update({ device_id: newDeviceId }).eq("id", c.id))
        );
        const failed = results.find((r) => r.error);
        if (failed?.error) throw new Error(failed.error.message);
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  // Xóa hẳn thiết bị đã off nguồn/không dùng nữa: xóa toàn bộ luồng thuộc
  // thiết bị (nhóm theo tên, kể cả nhóm CHƯA chuẩn hóa) + xóa luôn dòng
  // devices tương ứng nếu đã chuẩn hóa. Không thể hoàn tác nên luôn hỏi xác
  // nhận trước, giống các thao tác xóa khác trong app (RackHeader/PortTable).
  async function deleteGroup(g: Group) {
    const done = isGroupDone(g);
    const label = currentCanonicalName(g);
    if (!confirm(`Xóa thiết bị "${label}" và toàn bộ ${g.circuits.length} luồng liên quan?\n\nKhông thể hoàn tác.`)) {
      return;
    }
    setBusyKey(`${g.key}:delete`);
    setError(null);
    try {
      const ids = g.circuits.map((c) => c.id);
      const { error: delErr } = await supabase.from("circuits").delete().in("id", ids);
      if (delErr) throw new Error(delErr.message);

      const deviceId = g.circuits[0].deviceId;
      if (done && deviceId) {
        const { error: devErr } = await supabase.from("devices").delete().eq("id", deviceId);
        if (devErr) throw new Error(devErr.message);
        setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">Lỗi: {error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">
          {groups.length} nhóm thiết bị · còn {pendingCount} nhóm chưa chuẩn hóa
          {noDeviceNameCount > 0 && ` · ${noDeviceNameCount} luồng không đọc được tên thiết bị từ ghi chú`}
        </p>
        <div className="w-64">
          <FilterInput value={search} onChange={setSearch} placeholder="Tìm theo tên thiết bị..." />
        </div>
      </div>

      <div className="space-y-6">
        {categoryBuckets.map(([category, catGroups]) => (
          <div key={category}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {category} <span className="font-normal normal-case text-slate-400">({catGroups.length})</span>
            </h2>
            <div className="space-y-3">
              {catGroups.map((g) => {
                const done = isGroupDone(g);
                return (
                  <div
                    key={g.key}
                    className={`rounded-lg border p-4 ${done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      {done && <span className="text-xs font-medium text-emerald-700">✓ Đã chuẩn hóa</span>}
                      <input
                        className="input max-w-xs"
                        value={nameOverrides[g.key] ?? currentCanonicalName(g)}
                        onChange={(e) => setNameOverrides((prev) => ({ ...prev, [g.key]: e.target.value }))}
                      />
                      <button className="btn-primary" onClick={() => applyGroup(g)} disabled={busyKey !== null}>
                        {busyKey === `${g.key}:apply` ? "Đang lưu..." : done ? "Cập nhật" : "Áp dụng"}
                      </button>
                      <span className="text-sm text-slate-500">{g.circuits.length} luồng</span>
                      <button
                        className="ml-auto text-sm text-red-600 hover:underline disabled:text-slate-300"
                        onClick={() => deleteGroup(g)}
                        disabled={busyKey !== null}
                        title="Xóa thiết bị này và toàn bộ luồng liên quan (đã off nguồn/không dùng nữa)"
                      >
                        {busyKey === `${g.key}:delete` ? "Đang xóa..." : "Xóa thiết bị"}
                      </button>
                    </div>
                    {done && (
                      <p className="mt-1 text-xs text-slate-500">
                        Đổi tên ở đây thành tên 1 thiết bị đã chuẩn hóa khác để gộp 2 thiết bị làm 1.
                      </p>
                    )}
                    <p className="mt-2 text-sm text-slate-600">
                      Biến thể tên gốc:{" "}
                      {g.variants
                        .sort((a, b) => b.count - a.count)
                        .map((v) => `${v.text} (${v.count})`)
                        .join(", ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {categoryBuckets.length === 0 && <p className="text-sm text-slate-400">Không có nhóm nào khớp tìm kiếm.</p>}
      </div>
    </div>
  );
}
