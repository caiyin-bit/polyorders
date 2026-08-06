// 订单状态轮询入口,由 crond 每 5 分钟触发(本地手动:pnpm orders:poll)。
// 空轮秒退且不建交易客户端;沿用 watch 的做法不写 fetch_runs。
import { getPool } from "../src/db";
import { pollOrderStatuses } from "../src/trade/poll";

const started = Date.now();
const r = await pollOrderStatuses();
if (r.checked > 0) {
  console.log(
    `orders-poll: checked=${r.checked} settled=${r.settled} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}
await getPool().end();
