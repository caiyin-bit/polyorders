// 交易钱包体检:打印签名者、资金主体、pUSD 余额与授权额度。
// 注意:创建客户端会派生 L2 凭据,且 Deposit Wallet 未部署时会通过 relayer
// 部署它(gasless,一次性),所以本脚本并非纯只读。
// SDK 的类型声明导出了 AssetType,但运行时并未导出(取到会是 undefined)。
// 用 type-only 导入(编译后被擦除)+ 字面量断言绕开这个不一致。
import type { AssetType } from "@polymarket/client";
import { fetchBalanceAllowance, isWalletDeployed } from "@polymarket/client/actions";

const COLLATERAL = "COLLATERAL" as AssetType;
import { getTradeClient } from "../src/trade/client";
import { tradeLimits } from "../src/trade/risk";

function fmtUsd(baseUnits: string | bigint): string {
  return `$${(Number(baseUnits) / 1e6).toFixed(2)}`;
}

async function main() {
  const client = await getTradeClient();
  const { signer, wallet, walletType } = client.account;

  console.log("── 账户 ──");
  console.log(`签名者 EOA   : ${signer}`);
  console.log(`资金主体钱包 : ${wallet}`);
  console.log(`钱包类型     : ${walletType}`);
  if (signer.toLowerCase() === wallet.toLowerCase()) {
    console.log("  ↑ 以 EOA 自身作为资金主体(需被 allowlist 且自备 POL 付 gas)");
  }

  const deployed = await isWalletDeployed(client);
  console.log(`钱包已部署   : ${deployed ? "是" : "否"}`);

  console.log("\n── pUSD 余额与授权 ──");
  const ba = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
  console.log(`可用余额     : ${fmtUsd(ba.balance)}`);
  const allowances = Object.entries(ba.allowances);
  if (allowances.length === 0) {
    console.log("授权         : 无 —— 先跑 pnpm wallet:setup");
  } else {
    // 常规授权额度是 maxUint256,按美元格式化没有意义,直接标注为无上限
    const UNLIMITED = 10n ** 30n;
    for (const [spender, amount] of allowances) {
      const text =
        amount === 0n
          ? "未授权"
          : amount > UNLIMITED
            ? "已授权(无上限)"
            : fmtUsd(amount);
      console.log(`授权 ${spender} : ${text}`);
    }
  }

  const limits = tradeLimits();
  console.log("\n── 风控配置 ──");
  console.log(`发单模式     : ${limits.enabled ? "实盘" : "dry-run(不会真正发单)"}`);
  console.log(`单笔上限     : $${limits.maxUsd}`);
  console.log(`日累计上限   : $${limits.dailyMaxUsd}`);

  if (Number(ba.balance) === 0) {
    console.log(
      "\n⚠️  资金主体钱包余额为 0。若你在官网充过值,那笔钱在网页登录时创建的钱包里," +
        "\n   与此处的地址不是同一个。请把资金转到上面的「资金主体钱包」地址," +
        "\n   或把 POLYMARKET_WALLET_ADDRESS 设为官网账户的钱包地址。",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
