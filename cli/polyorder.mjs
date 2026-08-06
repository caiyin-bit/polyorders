#!/usr/bin/env node
// polyorder —— polyorders 的本地 CLI,包装线上 /api/agent/* 接口。
// 零依赖,输出一律 JSON(stdout),错误走 stderr + 非零退出码,方便 AI Agent 直接调用。
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_PATH =
  process.env.POLYORDERS_CONFIG ??
  join(homedir(), ".config", "polyorders", "config.json");
const DEFAULT_ORIGIN = "https://polyorders.bluesignals.cc";

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function origin() {
  return (
    process.env.POLYORDERS_ORIGIN ?? readConfig().origin ?? DEFAULT_ORIGIN
  );
}

function apiKey() {
  return process.env.POLYORDERS_API_KEY ?? readConfig().apiKey ?? null;
}

function fail(message, extra) {
  console.error(message);
  if (extra) console.error(extra);
  process.exit(1);
}

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

async function request(method, path, body, { auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) {
    const key = apiKey();
    if (!key) {
      fail(
        "没有 apiKey。先执行 `polyorder register` 注册,或 `polyorder config set apiKey <key>` 填入已有凭据。",
      );
    }
    headers.authorization = `Bearer ${key}`;
  }
  let res;
  try {
    res = await fetch(origin() + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`请求 ${origin()}${path} 失败:${err.message ?? err}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    // 403 未认领时把本地存的 claimUrl 一并提示,人类照着点即可
    const hint =
      res.status === 403 && readConfig().claimUrl
        ? `\n认领链接:${readConfig().claimUrl}`
        : "";
    fail(`HTTP ${res.status}:${data.error ?? text}${hint}`);
  }
  return data;
}

const HELP = `polyorder —— polyorders 命令行(${DEFAULT_ORIGIN})

用法:polyorder <命令> [参数]

命令:
  register [--name N] [--model M] [--description D]
                          注册新 agent,自动保存 apiKey 到本地配置,
                          输出 claimUrl —— 必须由人类打开并用 Telegram 登录认领,
                          认领前所有其它命令都会返回 403
  me                      查看身份、权限与当前风控限额(dry-run 与否、单笔/日上限)
  leaderboard             高胜率地址榜单与评分
  wallet <address>        某地址的评分、持仓与最近成交
  orders [--mine]         下单记录(--mine 只看本 agent 下的单)
  trade --market <M> --outcome yes|no --side buy|sell
        [--amount <USD>] [--shares <N>] [--limit <价格>]
                          下单。市价买用 --amount;卖出与限价单用 --shares;
                          限价单再加 --limit。market 支持 slug / 页面链接 / conditionId。
                          需要 trade 权限;服务端强制 dry-run 开关与金额限额
  skill                   拉取服务端给 Agent 的接入契约(SKILL.md)
  raw <GET|POST> <path> [json-body]
                          直接调任意 /api/agent/* 端点(逃生舱)
  config                  查看当前配置(apiKey 打码)
  config set <key> <val>  写配置,如 origin / apiKey

配置文件:${CONFIG_PATH}
环境变量覆盖:POLYORDERS_ORIGIN、POLYORDERS_API_KEY、POLYORDERS_CONFIG

示例:
  polyorder register --name claude-code --model claude-fable-5
  polyorder leaderboard
  polyorder wallet 0xabc...
  polyorder trade --market will-x-happen --outcome yes --side buy --amount 2
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "register": {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: "string", default: "polyorder-cli" },
          model: { type: "string" },
          description: { type: "string" },
        },
      });
      const data = await request(
        "POST",
        "/api/agent/register",
        {
          name: values.name,
          model: values.model,
          description:
            values.description ?? "polyorder-cli:开发机本地命令行接入",
        },
        { auth: false },
      );
      writeConfig({
        ...readConfig(),
        origin: origin(),
        apiKey: data.apiKey,
        agentId: data.agentId,
        claimUrl: data.claimUrl,
      });
      print({
        agentId: data.agentId,
        claimUrl: data.claimUrl,
        saved: CONFIG_PATH,
        next: "apiKey 已存入本地配置。请人类打开 claimUrl 用 Telegram 登录完成认领,之后 `polyorder me` 自检。",
      });
      return;
    }

    case "me":
      print(await request("GET", "/api/agent/me"));
      return;

    case "leaderboard":
      print(await request("GET", "/api/agent/leaderboard"));
      return;

    case "wallet": {
      const address = rest[0];
      if (!address) fail("用法:polyorder wallet <address>");
      print(await request("GET", `/api/agent/wallet/${address}`));
      return;
    }

    case "orders": {
      const mine = rest.includes("--mine");
      print(await request("GET", `/api/agent/orders${mine ? "?mine=1" : ""}`));
      return;
    }

    case "trade": {
      const { values } = parseArgs({
        args: rest,
        options: {
          market: { type: "string" },
          outcome: { type: "string" },
          side: { type: "string" },
          amount: { type: "string" },
          shares: { type: "string" },
          limit: { type: "string" },
        },
      });
      const side = values.side?.toUpperCase();
      if (!values.market || !["yes", "no"].includes(values.outcome ?? ""))
        fail("需要 --market 与 --outcome yes|no");
      if (side !== "BUY" && side !== "SELL") fail("需要 --side buy|sell");
      print(
        await request("POST", "/api/agent/trade", {
          market: values.market,
          outcome: values.outcome,
          side,
          amountUsd: values.amount ? Number(values.amount) : undefined,
          shares: values.shares ? Number(values.shares) : undefined,
          limitPrice: values.limit ? Number(values.limit) : undefined,
        }),
      );
      return;
    }

    case "skill": {
      let res;
      try {
        res = await fetch(origin() + "/SKILL.md");
      } catch (err) {
        fail(`请求 ${origin()}/SKILL.md 失败:${err.message ?? err}`);
      }
      if (!res.ok) fail(`HTTP ${res.status}`);
      console.log(await res.text());
      return;
    }

    case "raw": {
      const [method, path, json] = rest;
      if (!["GET", "POST"].includes(method?.toUpperCase() ?? "") || !path)
        fail("用法:polyorder raw <GET|POST> <path> [json-body]");
      print(
        await request(
          method.toUpperCase(),
          path,
          json === undefined ? undefined : JSON.parse(json),
        ),
      );
      return;
    }

    case "config": {
      if (rest[0] === "set") {
        const [, key, value] = rest;
        if (!key || value === undefined)
          fail("用法:polyorder config set <key> <value>");
        writeConfig({ ...readConfig(), [key]: value });
        print({ saved: CONFIG_PATH, [key]: key === "apiKey" ? "(已保存)" : value });
        return;
      }
      const config = readConfig();
      print({
        path: CONFIG_PATH,
        origin: origin(),
        ...config,
        apiKey: config.apiKey
          ? config.apiKey.slice(0, 14) + "…"
          : process.env.POLYORDERS_API_KEY
            ? "(来自环境变量)"
            : null,
      });
      return;
    }

    default:
      fail(`未知命令:${cmd}\n\n${HELP}`);
  }
}

main().catch((err) => fail(String(err?.message ?? err)));
