import { portfolioSnapshot } from "@/src/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ configured: true, ...(await portfolioSnapshot()) });
  } catch (err) {
    // 私钥未配置、Polymarket 不可达等:面板给出提示而不是整块报错
    return Response.json({ configured: false, error: String(err) });
  }
}
