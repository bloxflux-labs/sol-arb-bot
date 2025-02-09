import axios from "axios";
import "dotenv/config";
import { logger } from "./logger";

const jitoUrl = process.env.JITO_URL || "";
const concurrency = parseInt(process.env.BENCH_CONCURRENCY || "10", 10);
logger.info(`bench concurrency: ${concurrency}/s`);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 新增统计变量
let jitoRequestCount = 0;
let error429Count = 0;
let lastLogTime = Date.now();

// 每10秒输出统计信息
function logStatistics() {
  const now = Date.now();
  if (now - lastLogTime >= 10000) {
    // 10秒
    logger.warn(
      `统计 - 每10秒Jito成功请求量: ${jitoRequestCount}, 平均每秒: ${
        jitoRequestCount / 10
      }, 429错误次数: ${error429Count}`
    );
    jitoRequestCount = 0;
    error429Count = 0;
    lastLogTime = now;
  }
}

async function run() {
  const start = Date.now();

  const bundle = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTipAccounts",
    params: [],
  };

  const bundle_resp = await axios.post(`${jitoUrl}/api/v1/bundles`, bundle, {
    headers: {
      "Content-Type": "application/json",
    },
    // httpsAgent: agent, // 使用自定义 agent
    // localAddress: selectedIp, // 指定源IP地址
  } as any);
  if (bundle_resp.status === 200) {
    jitoRequestCount++; // 成功请求计数
    logger.info(`200: 发送成功`);
  } else {
    logger.error(`发送失败`);
  }

  // const tipAccounts = bundle_resp.data.result;
  // logger.info(`tipAccounts: ${tipAccounts}`);

  // cal time cost
  const end = Date.now();
  const duration = end - start;

  // logger.info(`total duration: ${duration}ms`);
}

async function main() {
  while (true) {
    const promises = Array(concurrency)
      .fill(null)
      .map(() =>
        run().catch((error) => {
          if (error.isAxiosError && error.response?.status === 429) {
            error429Count++; // 429错误计数
            // logger.error(`429: 请求过于频繁`);
          } else {
            logger.error(`发生错误: ${error.message}`);
          }
        })
      );

    await Promise.all(promises);

    // 输出统计信息
    logStatistics();
  }
}

main();
