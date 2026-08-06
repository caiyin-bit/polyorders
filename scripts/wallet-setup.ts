// 一次性交易授权:pUSD 对两个 Exchange 的 approve、CTF 的 setApprovalForAll。
// SDK 的 setupTradingApprovals 内部已做幂等处理,重复执行安全。
// AssetType 只存在于类型声明,运行时未导出,故用 type-only 导入 + 字面量断言
import type { AssetType } from "@polymarket/client";
import { fetchBalanceAllowance, updateBalanceAllowance } from "@polymarket/client/actions";

const COLLATERAL = "COLLATERAL" as AssetType;
import { getTradeClient } from "../src/trade/client";

async function main() {
  const client = await getTradeClient();
  console.log(`资金主体钱包: ${client.account.wallet}`);

  console.log("提交交易授权…");
  await client.setupTradingApprovals();

  // 链上授权落地后同步 CLOB 侧的额度缓存,否则首单可能因缓存未更新被拒
  console.log("同步 CLOB 额度缓存…");
  await updateBalanceAllowance(client, { assetType: COLLATERAL });

  const ba = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
  console.log(`完成。余额 $${(Number(ba.balance) / 1e6).toFixed(2)}`);
  for (const [spender, amount] of Object.entries(ba.allowances)) {
    console.log(`  ${spender}: ${amount > 0n ? "已授权" : "未授权"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
