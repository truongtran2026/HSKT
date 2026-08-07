// Tạo tài khoản test cho vai trò operator/viewer (mở rộng Đợt 3 Auth,
// 2026-08-06 — người dùng yêu cầu: "cho tôi sang các chế độ view, operator
// để tôi test"). Dùng Admin API của Supabase (service role key, KHÔNG phải
// DDL) để tạo user thật trong Supabase Auth và gán app_metadata.role ngay
// lúc tạo — JWT của tài khoản đó sẽ mang role này sau khi đăng nhập, đúng
// giá trị mà RLS (migration 20260806000001_authenticated_rls.sql) kiểm tra.
//
// Không tự đoán email người dùng — bắt buộc truyền --base-email, script tự
// suy ra 2 địa chỉ theo kiểu alias "+" (vd base+operator@gmail.com). Gmail
// (và phần lớn nhà cung cấp lớn khác) coi đây là tài khoản đăng nhập khác
// nhau, nhưng mail vẫn về đúng hộp thư chính base@gmail.com — không cần có
// 2 email thật riêng biệt để test.
//
// Chạy:
//   npm run create-role-accounts -- --base-email=ban@gmail.com            -> DRY RUN, chỉ in dự kiến.
//   npm run create-role-accounts -- --base-email=ban@gmail.com --commit   -> tạo thật, in mật khẩu ra
//                                                                            màn hình MỘT LẦN DUY NHẤT
//                                                                            (ghi lại ngay, không lưu ở đâu khác;
//                                                                            đổi được sau qua Supabase Dashboard).

import * as path from "node:path";
import * as crypto from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const baseEmailArg = process.argv.find((a) => a.startsWith("--base-email="));

type Role = "operator" | "viewer";

function randomPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

function aliasEmail(base: string, tag: string): string {
  const at = base.indexOf("@");
  if (at === -1) throw new Error(`Email không hợp lệ: "${base}"`);
  return `${base.slice(0, at)}+${tag}${base.slice(at)}`;
}

async function main() {
  if (!baseEmailArg) {
    console.error(
      "[create-role-test-accounts] Thiếu --base-email. Chạy:\n" +
        "  npm run create-role-accounts -- --base-email=ban@gmail.com"
    );
    process.exit(1);
  }
  const baseEmail = baseEmailArg.slice("--base-email=".length).trim();

  const accounts: { role: Role; email: string }[] = [
    { role: "operator", email: aliasEmail(baseEmail, "operator") },
    { role: "viewer", email: aliasEmail(baseEmail, "viewer") },
  ];

  console.log(`[create-role-test-accounts] Chế độ: ${COMMIT ? "COMMIT (tạo thật)" : "DRY RUN"}`);
  for (const acc of accounts) {
    console.log(`  - role="${acc.role}" email="${acc.email}"`);
  }

  if (!COMMIT) {
    console.log("\n[create-role-test-accounts] DRY RUN — chưa tạo gì. Chạy thêm --commit để tạo thật.");
    return;
  }

  const { getSupabaseAdmin } = await import("./lib/supabaseAdmin");
  const supabase = getSupabaseAdmin();

  console.log("");
  for (const acc of accounts) {
    const password = randomPassword();
    const { error } = await supabase.auth.admin.createUser({
      email: acc.email,
      password,
      email_confirm: true,
      app_metadata: { role: acc.role },
    });
    if (error) {
      console.error(`[create-role-test-accounts] Lỗi tạo "${acc.email}": ${error.message}`);
      continue;
    }
    console.log(`[create-role-test-accounts] Đã tạo role="${acc.role}":`);
    console.log(`    email:    ${acc.email}`);
    console.log(`    password: ${password}`);
  }
  console.log(
    "\n[create-role-test-accounts] Ghi lại mật khẩu ở trên NGAY — không hiện lại lần 2. Đăng nhập thử tại /login."
  );
}

main().catch((err) => {
  console.error("[create-role-test-accounts] Lỗi:", err);
  process.exit(1);
});
