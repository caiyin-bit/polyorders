// 启动时校验配置。
//
// 动机:配错一个环境变量的代价原本是「运行到那行代码才炸」——抓取跑到一半、
// 或者下单那一刻才发现私钥没配。挪到进程启动时检查,错配在部署那一步就暴露。
//
// 分两档:fatal 直接让进程起不来,warn 只打日志。判断标准是「继续跑下去会不会
// 产生错误的结果或错误的安全预期」——比如声称实盘却没有私钥,属于前者。

export type EnvReport = { fatal: string[]; warn: string[] };

/** web 进程额外需要的:少了这些登录链路直接不可用 */
const WEB_REQUIRED = [
  "AUTH_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_ALLOWED_IDS",
];

export function inspectEnv(
  scope: "web" | "worker",
  env: Record<string, string | undefined> = process.env,
): EnvReport {
  const fatal: string[] = [];
  const warn: string[] = [];

  if (!env.DATABASE_URL) fatal.push("DATABASE_URL 未配置,数据库不可用");

  if (scope === "web") {
    for (const k of WEB_REQUIRED) {
      if (!env[k]) fatal.push(`${k} 未配置,登录链路不可用`);
    }
  }

  // 声称实盘却没有签名私钥:下单会在最后一刻失败,不如现在就拦住
  if (env.TRADING_ENABLED === "true" && !env.POLYMARKET_PRIVATE_KEY) {
    fatal.push("TRADING_ENABLED=true 但 POLYMARKET_PRIVATE_KEY 未配置");
  }

  const maxUsd = Number(env.TRADE_MAX_USD);
  const dailyUsd = Number(env.TRADE_DAILY_MAX_USD);
  if (maxUsd > 0 && dailyUsd > 0 && maxUsd > dailyUsd) {
    warn.push(
      `TRADE_MAX_USD($${maxUsd}) 大于 TRADE_DAILY_MAX_USD($${dailyUsd}),日累计上限形同虚设`,
    );
  }

  if (env.TELEGRAM_BOT_TOKEN && !env.TELEGRAM_ALERT_CHAT_ID) {
    warn.push("TELEGRAM_ALERT_CHAT_ID 未配置,抓取失败与交易异常不会发出告警");
  }

  // 配了一半的 relayer 凭据不会生效,而现象是「Deposit Wallet 部署失败」,
  // 从报错很难联想到这里少了一个变量
  const relayerKey = Boolean(env.POLYMARKET_RELAYER_KEY);
  const relayerAddr = Boolean(env.POLYMARKET_RELAYER_ADDRESS);
  if (relayerKey !== relayerAddr) {
    warn.push(
      "POLYMARKET_RELAYER_KEY 与 POLYMARKET_RELAYER_ADDRESS 必须成对配置,当前只配了一个",
    );
  }

  return { fatal, warn };
}

/** 打印警告;有 fatal 则抛错终止进程 */
export function assertEnv(scope: "web" | "worker"): void {
  const { fatal, warn } = inspectEnv(scope);
  for (const w of warn) console.warn(`⚠️  配置警告:${w}`);
  if (fatal.length > 0) {
    throw new Error(`配置错误,进程无法启动:\n  - ${fatal.join("\n  - ")}`);
  }
}
