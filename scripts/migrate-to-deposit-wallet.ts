// 把 pUSD 从旧的 Poly Proxy 钱包转到 Deposit Wallet。
//
// CLOB V2 只接受 Deposit Wallet 作为 maker,用旧 proxy 下单会被
// "maker address not allowed, please use the deposit wallet flow" 直接拒绝,
// 所以历史资金必须搬过去才能继续用 API 交易。
// 转账由 relayer 代付 gas,需要 .env 中配好 POLYMARKET_RELAYER_KEY/ADDRESS。
//
// 用法: tsx scripts/migrate-to-deposit-wallet.ts <proxy地址> <deposit地址> <美元金额>
import { production, type AssetType } from "@polymarket/client";
import { fetchBalanceAllowance } from "@polymarket/client/actions";
import { getTradeClient } from "../src/trade/client";

const COLLATERAL = "COLLATERAL" as AssetType;
// production 运行时带完整合约表,但导出的 EnvironmentConfig 类型只声明了
// name/chainId(同 wallet-doctor.ts 里 AssetType 的处理,断言绕开这个不一致)
const { collateralToken } = (
  production as unknown as { contracts: { collateralToken: string } }
).contracts;

const [from, to, usd] = process.argv.slice(2);
if (!from || !to || !(Number(usd) > 0)) {
  console.error(
    "用法: tsx scripts/migrate-to-deposit-wallet.ts <proxy地址> <deposit地址> <美元金额>",
  );
  process.exit(1);
}

// 资金主体必须是转出方,否则签出来的是 deposit wallet 转给自己
process.env.POLYMARKET_WALLET_ADDRESS = from;

const client = await getTradeClient();
if (client.account.wallet.toLowerCase() !== from.toLowerCase()) {
  throw new Error(
    `资金主体应为 ${from},实际是 ${client.account.wallet}——检查 POLYMARKET_WALLET_ADDRESS`,
  );
}

const before = await fetchBalanceAllowance(client, { assetType: COLLATERAL });
const amount = BigInt(Math.round(Number(usd) * 1e6));
if (amount > BigInt(before.balance)) {
  throw new Error(
    `余额不足:可用 $${(Number(before.balance) / 1e6).toFixed(2)},本次要转 $${usd}`,
  );
}

console.log(`转出方 : ${from}(余额 $${(Number(before.balance) / 1e6).toFixed(2)})`);
console.log(`接收方 : ${to}`);
console.log(`金额   : $${usd}`);

const handle = await client.transferErc20({
  amount,
  recipientAddress: to,
  tokenAddress: collateralToken,
});
const outcome = await handle.wait();
console.log(`完成,交易哈希: ${outcome.transactionHash}`);
