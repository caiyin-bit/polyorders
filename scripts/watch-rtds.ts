// 常驻入口:RTDS 实时 watcher。由 docker-compose.vps.yml 的 watcher 服务拉起。
import { runWatcher } from "../src/watch/rtds";

runWatcher().catch((err) => {
  console.error(err);
  process.exit(1);
});
