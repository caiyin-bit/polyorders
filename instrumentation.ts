import { assertEnv } from "@/src/env";

/** Next 的启动钩子:配置错了就别让服务起来,免得跑到一半才暴露 */
export function register() {
  assertEnv("web");
}
