// 一次性交易授权:pUSD 对两个 Exchange 的 approve、CTF 的 setApprovalForAll。
// SDK 的 setupTradingApprovals 内部已做幂等处理,重复执行安全。
// AssetType 只存在于类型声明,运行时未导出,故用 type-only 导入 + 字面量断言
import { production, type AssetType } from "@polymarket/client";
import { fetchBalanceAllowance, updateBalanceAllowance } from "@polymarket/client/actions";

const COLLATERAL = "COLLATERAL" as AssetType;
// production 运行时带完整合约表,导出的类型却只声明了 name/chainId,断言绕开
const { collateralToken } = (
  production as unknown as { contracts: { collateralToken: string } }
).contracts;
import { getTradeClient } from "../src/trade/client";

async function main() {
  const client = await getTradeClient();
  console.log(`资金主体钱包: ${client.account.wallet}`);

  console.log("提交交易授权…");
  await client.setupTradingApprovals();

  // setupTradingApprovals 不覆盖 neg-risk adapter,而 neg-risk 市场(多候选人盘)
  // 下单必须有它的授权,否则 CLOB 直接以 allowance: 0 拒单。按实际额度补齐缺口。
  const current = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
  for (const [spender, amount] of Object.entries(current.allowances)) {
    if (amount > 0n) continue;
    console.log(`补授权 ${spender}…`);
    const handle = await client.approveErc20({
      amount: "max",
      spenderAddress: spender,
      tokenAddress: collateralToken,
    });
    await handle.wait();
  }

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
