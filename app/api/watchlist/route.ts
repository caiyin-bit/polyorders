import { requireAdmin } from "@/src/session";
import {
  addToWatchlist,
  normalizeAddress,
  removeFromWatchlist,
  watchlistView,
} from "@/src/watchlist";

export const dynamic = "force-dynamic";

// 受 middleware 保护(登录后才可达);逻辑与 agent 版共用 src/watchlist.ts

export async function GET() {
  return Response.json(await watchlistView());
}

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("denied" in guard) return guard.denied;
  let raw: unknown;
  let username: string | null = null;
  try {
    const body = (await req.json()) as { address?: unknown; username?: unknown };
    raw = body.address;
    // 显示名来自 resolve 端点的解析结果,回填 candidates 用
    if (typeof body.username === "string" && body.username.trim()) {
      username = body.username.trim().slice(0, 100);
    }
  } catch {}
  const address = normalizeAddress(raw);
  if (!address) {
    return Response.json({ error: "地址格式不合法" }, { status: 400 });
  }

  const err = await addToWatchlist(address, guard.user.id, username);
  if (err) return Response.json({ error: err }, { status: 409 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if ("denied" in guard) return guard.denied;
  let raw: unknown;
  try {
    raw = ((await req.json()) as { address?: unknown }).address;
  } catch {}
  const address = normalizeAddress(raw);
  if (!address) {
    return Response.json({ error: "地址格式不合法" }, { status: 400 });
  }

  await removeFromWatchlist(address);
  return Response.json({ ok: true });
}
