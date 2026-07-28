"use client";

// Tay kéo đổi độ rộng cột — đặt trong 1 <th className="relative ..."> bất kỳ
// (không phụ thuộc ResizableTh/SortableTh) để dùng được cho cả header tùy
// biến riêng của từng bảng (vd DeviceCircuitList.tsx gộp chung lọc+sắp xếp
// trong 1 <th>). Bảng cha cần dùng `table-fixed` + <colgroup> thì width mới
// thật sự có tác dụng (xem PortTable.tsx).
export default function ColumnResizeHandle({ width, onResize }: { width: number; onResize: (width: number) => void }) {
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    function onMouseMove(ev: MouseEvent) {
      onResize(startWidth + (ev.clientX - startX));
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <span
      onMouseDown={handleMouseDown}
      title="Kéo để đổi độ rộng cột"
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary-300 active:bg-primary-400"
    />
  );
}
