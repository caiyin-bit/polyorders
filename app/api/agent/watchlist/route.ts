import { authErrorResponse, requireAgent, requireScope } from "@/src/agent-auth";
import {
  addToWatchlist,
  normalizeAddress,
  removeFromWatchlist,
  watchlistView,
} from "@/src/watchlist";

export const dynamic = "force-dynamic";

// 关注池:读取只需 read,增删需要独立的 watch 权限。
// 理由是改动关注池会改变跟单引擎的输入——live 模式下等于间接触发下单,
// 这个后果不该由一个只有 read 的 agent 造成。

export async function GET(req: Request) {
  try {
    await requireAgent(req);
    return Response.json(await watchlistView());
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}

async function mutate(
  req: Request,
  action: (address: string, username: string | null) => Promise<string | null>,
) {
  try {
    const agent = await requireAgent(req);
    requireScope(agent, "watch");

    let raw: unknown;
    let username: string | null = null;
    try {
      const body = (await req.json()) as { address?: unknown; username?: unknown };
      raw = body.address;
      // 榜单外地址的显示名回填 candidates 用,与人类面板入口同款(可选)
      if (typeof body.username === "string" && body.username.trim()) {
        username = body.username.trim().slice(0, 100);
      }
    } catch {}
    const address = normalizeAddress(raw);
    if (!address) {
      return Response.json({ error: "地址格式不合法" }, { status: 400 });
    }

    const failure = await action(address, username);
    if (failure) return Response.json({ error: failure }, { status: 409 });
    return Response.json({ ok: true, address, ...(await watchlistView()) });
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: String(err) }, { status: 500 });
  }
}

export function POST(req: Request) {
  return mutate(req, (address, username) =>
    addToWatchlist(address, undefined, username),
  );
}

export function DELETE(req: Request) {
  return mutate(req, async (address) => {
    await removeFromWatchlist(address);
    return null;
  });
}
