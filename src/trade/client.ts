import { createSecureClient, relayerApiKey } from "@polymarket/client";
import { privateKey } from "@polymarket/client/viem";

// createSecureClient 的返回类型带泛型参数,直接推导避免手写实参出错
type TradeClient = Awaited<ReturnType<typeof createSecureClient>>;

// 挂 globalThis 防止 Next.js dev HMR 重载模块时重复建客户端(同 src/db.ts)
const g = globalThis as unknown as { __pmClient?: Promise<TradeClient> };

/**
 * 交易客户端单例。
 *
 * 首次创建会做两件有副作用的事:派生 L2 API 凭据(需私钥签名),
 * 以及在 Deposit Wallet 尚未部署时通过 relayer 部署它(gasless,一次性)。
 */
export function getTradeClient(): Promise<TradeClient> {
  if (!g.__pmClient) {
    const key = process.env.POLYMARKET_PRIVATE_KEY;
    if (!key) throw new Error("POLYMARKET_PRIVATE_KEY 未配置");

    const relayerKey = process.env.POLYMARKET_RELAYER_KEY;
    const relayerAddress = process.env.POLYMARKET_RELAYER_ADDRESS;

    g.__pmClient = createSecureClient({
      signer: privateKey(key),
      // 省略 wallet 时 SDK 用 signer 派生的 Deposit Wallet 作为资金主体;
      // 配置了则以该地址为主体(例如官网账户的钱包)
      ...(process.env.POLYMARKET_WALLET_ADDRESS
        ? { wallet: process.env.POLYMARKET_WALLET_ADDRESS }
        : {}),
      ...(relayerKey && relayerAddress
        ? { apiKey: relayerApiKey({ key: relayerKey, address: relayerAddress }) }
        : {}),
    }).catch((err: unknown) => {
      // 失败不缓存,否则配置修好后仍会一直复用被拒的 Promise
      g.__pmClient = undefined;
      throw err;
    });
  }
  return g.__pmClient;
}
