// Tách riêng khỏi DeviceCircuitList.tsx (file "use client") vì
// DeviceRackPortView.tsx (Server Component) cần gọi hàm này — Next.js App
// Router KHÔNG cho Server Component dùng trực tiếp export thường (không phải
// component) từ 1 module "use client" (runtime error "is not a function"),
// nên phải để hàm thuần này ở file riêng không có "use client".
export function rowAnchor(circuitId: string): string {
  return `dc-${circuitId}`;
}
