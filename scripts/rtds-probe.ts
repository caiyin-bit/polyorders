// RTDS 协议探针:连上全平台成交流,原样 dump 若干帧后退出。
// 保留为诊断工具——协议变动时重跑一次即可确认封套与字段。
//
// 用法: pnpm exec tsx scripts/rtds-probe.ts [持续秒数=60]

const RTDS_URL = "wss://ws-live-data.polymarket.com";
const seconds = Number(process.argv[2]) || 60;

let frameCount = 0;
let firstPayloadPrinted = false;
const tsSamples: number[] = [];
const keySets = new Set<string>();

const ws = new WebSocket(RTDS_URL);

ws.addEventListener("open", () => {
  console.log(`已连接 ${RTDS_URL},订阅 activity/trades…`);
  ws.send(
    JSON.stringify({
      action: "subscribe",
      subscriptions: [{ topic: "activity", type: "trades" }],
    }),
  );
});

// RTDS 要求应用层心跳:每 5 秒一个文本 PING 帧
const ping = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) ws.send("PING");
}, 5000);

ws.addEventListener("message", (ev: MessageEvent) => {
  frameCount++;
  const raw = String(ev.data);

  // 前两帧原样打印,用来看清封套结构
  if (frameCount <= 2) {
    console.log(`\n── 原始帧 #${frameCount} ──\n${raw.slice(0, 1200)}`);
  }

  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.log(`(非 JSON 帧: ${raw.slice(0, 80)})`);
    return;
  }

  // 封套可能是单条或数组,payload 可能嵌在 payload/data 字段里
  const items = Array.isArray(msg) ? msg : [msg];
  for (const item of items) {
    const o = item as Record<string, unknown>;
    const payload = (o.payload ?? o.data ?? o) as Record<string, unknown>;
    keySets.add(Object.keys(payload).sort().join(","));

    if (typeof payload.timestamp === "number") tsSamples.push(payload.timestamp);

    if (!firstPayloadPrinted && payload.proxyWallet) {
      firstPayloadPrinted = true;
      console.log("\n── 首个含 proxyWallet 的 payload ──");
      console.log(JSON.stringify(payload, null, 2).slice(0, 1500));
    }
  }
});

ws.addEventListener("error", (e) => console.error("WS 错误:", String(e)));
ws.addEventListener("close", (e: CloseEvent) =>
  console.log(`连接关闭 code=${e.code} reason=${e.reason}`),
);

setTimeout(() => {
  clearInterval(ping);
  console.log(`\n════ ${seconds} 秒统计 ════`);
  console.log(`收到帧数: ${frameCount}`);

  console.log(`\n出现过的 payload 字段组合(${keySets.size} 种):`);
  for (const k of keySets) console.log("  " + k.slice(0, 400));

  if (tsSamples.length > 0) {
    const t = tsSamples[0];
    const now = Date.now();
    const unit = t > 1e12 ? "毫秒" : "秒";
    const skewS = Math.abs((t > 1e12 ? t : t * 1000) - now) / 1000;
    console.log(`\ntimestamp 样本: ${t}`);
    console.log(`  判定单位: ${unit}(与当前时间差 ${skewS.toFixed(1)} 秒)`);
  } else {
    console.log("\n未采到 timestamp 样本");
  }

  ws.close();
  process.exit(0);
}, seconds * 1000);
