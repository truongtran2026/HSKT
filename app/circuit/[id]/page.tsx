import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { findLinkedDeviceTrunkPairs, type CircuitPairDetail } from "@/lib/circuitPairSync";
import { fetchCircuitDetail } from "@/lib/circuitDetail";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Trang "Chi tiết một luồng" (Đợt 4 audit mục 3.2, HSKT-audit-2026-08-03.md)
// — đích đến CHUNG cho MirrorLinkBadge, kết quả tìm kiếm, các tab Chất lượng
// dữ liệu: xem TOÀN TUYẾN của 1 đấu nối (thiết bị -> ODF thiết bị -> ODF
// trung kế -> tuyến cáp) trên CÙNG 1 khung nhìn, thay vì phải tự nhảy giữa
// Hồ sơ đấu nối và Hồ sơ ODF Trung kế rồi tự so trong đầu. Toàn bộ dữ liệu so
// khớp (nameMatch/ownPositionMatch/nextPositionMatch/tribMatch) ĐàCÓ SẴN
// trong CircuitPairDetail (lib/circuitPairSync.ts) — trang này chỉ dựng giao
// diện, không viết logic so sánh mới, đúng như audit gốc chỉ định.
export const dynamic = "force-dynamic";

async function findPair(supabase: SupabaseClient, id: string): Promise<CircuitPairDetail | null> {
  // Cùng cỡ dữ liệu mà app/odf-trunk/[rackId]/page.tsx đã tải mỗi lần render
  // (audit mục 5.1 có phê bình chi phí này ở TRANG DANH SÁCH lặp lại nhiều
  // lần — nhưng đây là trang chi tiết/permalink, tải 1 lần khi có người bấm
  // vào, không lặp lại như trang danh sách, nên chấp nhận được; tối ưu bằng
  // RPC/materialized view riêng cho trang này để dành Đợt 5).
  const [trunkPorts, deviceCircuits] = await Promise.all([fetchAllOdfPorts(supabase), fetchDeviceCircuits(supabase)]);
  const pairs = findLinkedDeviceTrunkPairs(trunkPorts, deviceCircuits);
  return pairs.find((p) => p.deviceCircuitId === id || p.trunkCircuitId === id) ?? null;
}

export default async function CircuitDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createSupabaseServerClient();
  const pair = await findPair(supabase, params.id);

  if (pair) return <PairView pair={pair} supabase={supabase} />;

  // Không phải 1 cặp thiết bị-trung kế ĐÃ liên kết thật (mirror_of_id) — có
  // thể là luồng chỉ thuộc 1 bên (chỉ trung kế, hoặc chỉ thiết bị chưa/không
  // có mirror), hoặc 1 cặp mới ở dạng "candidate" (khớp vị trí nhưng CHƯA
  // liên kết — cố tình KHÔNG hiện ở đây, xem tooltip MirrorLinkBadge: dẫn
  // qua tab Chất lượng dữ liệu để XÁC NHẬN trước, tránh trang permalink ngầm
  // định "đã đúng" một quan hệ chưa được người dùng xác nhận). Vẫn hiện được
  // thông tin 1 phía — hữu ích hơn hẳn trang 404.
  const single = await fetchCircuitDetail(supabase, params.id);
  if (!single) notFound();
  return <SingleView circuit={single} />;
}

// ----------------------------------------------------------------------------
// Cặp ĐÃ liên kết — khung so sánh 2 hồ sơ + chuỗi hình ảnh toàn tuyến, đúng
// mockup trong audit gốc mục 3.2.
// ----------------------------------------------------------------------------
async function PairView({ pair, supabase }: { pair: CircuitPairDetail; supabase: SupabaseClient }) {
  // response_plan_text/execution_station_text không có sẵn trong
  // CircuitPairDetail (không phải trường được đối chiếu 2 bên) — lấy riêng
  // từ luồng trung kế (hồ sơ M3.CQ-3, nguồn chính thức cho 2 trường vận hành
  // này) bằng 1 truy vấn nhỏ, gọn hơn hẳn tải lại nguyên circuitDetail.
  const { data: trunkExtra } = await supabase
    .from("circuits")
    .select("response_plan_text, execution_station_text")
    .eq("id", pair.trunkCircuitId)
    .maybeSingle();

  const hasMismatch = !pair.nameMatch || pair.ownPositionMatch === false || pair.nextPositionMatch === false || pair.tribMatch === false;

  return (
    <div className="max-w-4xl">
      <Link href="/search" className="text-sm text-primary-600 hover:underline">
        ← Tìm kiếm
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-primary-800">{pair.deviceName}</h1>
        {hasMismatch ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700" title="1 trong các trường đối chiếu đang lệch giữa 2 bên — xem bảng bên dưới.">
            ⚠️ Dữ liệu lệch
          </span>
        ) : (
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">🔗 Đã liên kết</span>
        )}
      </div>

      {/* Chuỗi toàn tuyến — 4 khối nối bằng mũi tên, đúng mockup audit gốc. */}
      <div className="mt-4 flex flex-wrap items-stretch gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <ChainBox label="Thiết bị" title={pair.deviceDeviceName ?? pair.deviceName} sub={pair.deviceTrib ? `trib ${pair.deviceTrib}` : null} />
        <Arrow />
        <ChainBox label="ODF thiết bị" title={pair.deviceOwnPosition ?? "—"} />
        <Arrow />
        <ChainBox label="ODF trung kế" title={pair.trunkOwnPositionCanonical} />
        <Arrow />
        <ChainBox label="Tuyến cáp" title={pair.rackCode} />
      </div>

      {(trunkExtra?.response_plan_text || trunkExtra?.execution_station_text) && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          {trunkExtra?.response_plan_text && <p>Phương án ứng cứu: {trunkExtra.response_plan_text}</p>}
          {trunkExtra?.execution_station_text && <p>Trạm thực hiện: {trunkExtra.execution_station_text}</p>}
        </div>
      )}

      {/* Bảng so sánh 2 hồ sơ cạnh nhau — giá trị lớn nhất của trang này theo
          audit gốc: lệch chỗ nào thấy ngay, không phải tự nhớ rồi so 2 trang. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium text-slate-700">Hồ sơ đấu nối (thiết bị)</p>
            <Link href={`/odf-device/sua-luong#${rowAnchor(pair.deviceCircuitId)}`} className="text-xs text-primary-600 hover:underline">
              Sửa →
            </Link>
          </div>
          <PairRow label="Tên" value={pair.deviceName} mismatch={!pair.nameMatch} />
          <PairRow label="Trib" value={pair.deviceTrib} mismatch={pair.tribMatch === false} />
          <PairRow label="Vị trí ODF" value={pair.deviceOwnPosition} mismatch={pair.ownPositionMatch === false} />
          <PairRow label="Vị trí ODF tiếp" value={pair.deviceNextPosition} mismatch={pair.nextPositionMatch === false} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium text-slate-700">Hồ sơ ODF trung kế</p>
            <Link href={`/odf-trunk/${pair.rackId}#port-${pair.trunkFirstPortId}`} className="text-xs text-primary-600 hover:underline">
              Sửa →
            </Link>
          </div>
          <PairRow label="Tên" value={pair.trunkName} mismatch={!pair.nameMatch} />
          <PairRow label="Chuyển tiếp (Trib)" value={pair.trunkTransitTrib} mismatch={pair.tribMatch === false} />
          <PairRow label="Chuyển tiếp (ODF)" value={pair.trunkTransitOdfPart} mismatch={pair.ownPositionMatch === false} />
          <PairRow label="Port thật" value={pair.trunkOwnPositionCanonical} mismatch={pair.nextPositionMatch === false} />
        </div>
      </div>
    </div>
  );
}

function ChainBox({ label, title, sub }: { label: string; title: string; sub?: string | null }) {
  return (
    <div className="flex min-w-[140px] flex-1 flex-col items-center justify-center rounded-md border border-slate-200 bg-slate-50 p-3 text-center">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 font-medium text-slate-700">{title}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Arrow() {
  return <span className="flex shrink-0 items-center text-slate-300">→</span>;
}

function PairRow({ label, value, mismatch }: { label: string; value: string | null; mismatch: boolean }) {
  return (
    <div className={"flex items-baseline justify-between gap-2 border-t border-slate-100 py-1.5 first:border-t-0" + (mismatch ? " bg-amber-50" : "")}>
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className={"text-right " + (mismatch ? "font-medium text-amber-700" : "text-slate-700")}>{value ?? "—"}</span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Luồng đơn — không phải 1 cặp đã liên kết thật (chỉ trung kế, chỉ thiết bị,
// hoặc candidate chưa xác nhận). Thông tin cơ bản CHỈ XEM, không có form sửa.
// ----------------------------------------------------------------------------
function SingleView({ circuit }: { circuit: NonNullable<Awaited<ReturnType<typeof fetchCircuitDetail>>> }) {
  const isTrunk = circuit.trunkPorts.length > 0;
  const isDevice = !!circuit.device;

  return (
    <div className="max-w-2xl">
      <Link href="/search" className="text-sm text-primary-600 hover:underline">
        ← Tìm kiếm
      </Link>

      <h1 className="mt-2 text-xl font-bold text-primary-800">{circuit.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {circuit.circuitRole === "active" ? "Đang hoạt động" : "Dự phòng"}
        {circuit.interfaceType ? ` · ${circuit.interfaceType}` : ""}
      </p>

      <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <Row label="Đối phương" value={circuit.counterpartText} />
        <Row label="Phương án ứng cứu" value={circuit.responsePlanText} />
        <Row label="Trạm thực hiện" value={circuit.executionStationText} />
        <Row label="Trib" value={circuit.tribText} />
        <Row label="Ghi chú" value={circuit.notes} />
      </div>

      {isTrunk && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-700">Vị trí ODF trung kế</p>
          <p className="mt-1 text-slate-600">
            {circuit.trunkPorts[0].rackCode} — port {circuit.trunkPorts.map((p) => p.portNumber).join(", ")}
          </p>
          <Link href={`/odf-trunk/${circuit.trunkPorts[0].rackId}#port-${circuit.trunkPorts[0].id}`} className="mt-2 inline-block text-primary-600 hover:underline">
            Sửa ở Hồ sơ ODF Trung kế →
          </Link>
        </div>
      )}

      {isDevice && circuit.device && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="font-medium text-slate-700">Thiết bị</p>
          <p className="mt-1 text-slate-600">{circuit.device.fullLabel ?? circuit.device.name}</p>
          {(circuit.devicePositionOwn || circuit.devicePositionNext) && (
            <p className="mt-1 text-slate-600">
              {circuit.devicePositionOwn ?? "—"}
              {circuit.devicePositionNext ? ` → ${circuit.devicePositionNext}` : ""}
            </p>
          )}
          <Link href={`/odf-device/sua-luong#${rowAnchor(circuit.id)}`} className="mt-2 inline-block text-primary-600 hover:underline">
            Sửa ở Hồ sơ đấu nối →
          </Link>
        </div>
      )}

      {(circuit.mirrorOrigin || circuit.mirrorChild) && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
          <p className="font-medium text-amber-800">Luồng liên quan (mirror tự sinh)</p>
          {circuit.mirrorOrigin && (
            <p className="mt-1 text-slate-600">
              Là bản sao tự sinh của{" "}
              <Link href={`/circuit/${circuit.mirrorOrigin.id}`} className="text-primary-600 hover:underline">
                {circuit.mirrorOrigin.name}
              </Link>
            </p>
          )}
          {circuit.mirrorChild && (
            <p className="mt-1 text-slate-600">
              Đã tự sinh bản sao{" "}
              <Link href={`/circuit/${circuit.mirrorChild.id}`} className="text-primary-600 hover:underline">
                {circuit.mirrorChild.name}
              </Link>
            </p>
          )}
        </div>
      )}

      {!isTrunk && !isDevice && (
        <p className="mt-4 text-sm text-slate-400">Luồng chưa gán vào port trung kế hay thiết bị nào — chỉ tồn tại dạng ghi chú tự do.</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 whitespace-pre-line text-slate-700">{value}</p>
    </div>
  );
}
