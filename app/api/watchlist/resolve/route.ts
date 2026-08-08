import { parseWatchInput, resolveWatchInput } from "@/src/watchlist";

export const dynamic = "force-dynamic";

// 自由输入 → 可入池候选。输入支持地址 / profile 链接 / @handle / 用户名,
// 解析在服务端做(首尔出口访问 gamma API)。受 middleware 登录保护

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q");
  const input = parseWatchInput(q);
  if (!input) {
    return Response.json(
      { error: "无法识别:请输入 0x 地址、Polymarket 主页链接或用户名" },
      { status: 400 },
    );
  }
  try {
    const candidates = await resolveWatchInput(input);
    if (candidates.length === 0) {
      return Response.json(
        { error: `没找到名为「${input.kind === "username" ? input.username : ""}」的账号` },
        { status: 404 },
      );
    }
    return Response.json({ candidates });
  } catch (err) {
    return Response.json(
      { error: `解析失败:${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
