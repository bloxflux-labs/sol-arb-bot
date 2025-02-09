import axios from "axios";
import "dotenv/config";
import pLimit from "p-limit";
import { logger } from "./logger";

const jitoUrl = process.env.JITO_URL || "https://amsterdam.mainnet.block-engine.jito.wtf";
const concurrency = parseInt(process.env.CONCURRENCY || "10", 10); // 并发量
const limit = pLimit(concurrency); // 创建并发限制器
logger.info(`jito url: ${jitoUrl}`);
logger.info(`send request concurrency: ${concurrency}/s`);

// const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 统计变量
let jitoRequestCount = 0;
let error429Count = 0;
let totalRequestCount = 0;
let lastLogTime = Date.now();

// 每10秒输出统计信息
function logStatistics() {
  const now = Date.now();
  if (now - lastLogTime >= 10000) {
    logger.warn(
      `统计 - 每10秒发送请求总量: ${totalRequestCount}, 成功请求量: ${jitoRequestCount}, 平均每秒: ${(
        jitoRequestCount / 10
      ).toFixed(1)}, 429错误次数: ${error429Count}`
    );
    totalRequestCount = 0;
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

  try {
    const bundle_resp = await axios.post(`${jitoUrl}/api/v1/bundles`, bundle, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (bundle_resp.status === 200) {
      jitoRequestCount++; // 成功请求计数
      const duration = Date.now() - start;
      // logger.info(`200: 发送成功, 耗时: ${duration}ms`);
    } else {
      logger.error(`发送失败`);
    }
  } catch (error) {
    const duration = Date.now() - start;
    if (error.isAxiosError && error.response?.status === 429) {
      error429Count++; // 429错误计数
      // logger.error(`429: 请求过于频繁, 耗时: ${duration}ms`);
    } else {
      logger.error(`请求失败, 耗时: ${duration}ms, 错误: ${error.message}`);
    }
  }
}

async function main() {
  // 每秒发送 concurrency 个请求
  setInterval(() => {
    for (let i = 0; i < concurrency; i++) {
      limit(() =>
        run().catch((error) => {
          logger.error(`发生错误: ${error.message}`);
        })
      );
    }
    totalRequestCount += concurrency; // 统计总请求量
  }, 1000); // 每秒执行一次

  // 每10秒输出统计信息
  setInterval(logStatistics, 10000);
}

main();
