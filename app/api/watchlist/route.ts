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
  let raw: unknown;
  try {
    raw = ((await req.json()) as { address?: unknown }).address;
  } catch {}
  const address = normalizeAddress(raw);
  if (!address) {
    return Response.json({ error: "地址格式不合法" }, { status: 400 });
  }

  const err = await addToWatchlist(address);
  if (err) return Response.json({ error: err }, { status: 409 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
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
