import { Mutex } from "async-mutex";
import axios from "axios";
import "dotenv/config";
import pLimit from "p-limit";
import { logger } from "./logger";

// 从环境变量读取 Jito URL 和并发量，设置默认值
const jitoUrl = process.env.JITO_URL || "https://amsterdam.mainnet.block-engine.jito.wtf";
const concurrency = parseInt(process.env.JITO_CONCURRENCY || "10", 10); // 并发量，默认 10
const limit = pLimit(concurrency); // 创建并发限制器

// 创建互斥锁
const statsMutex = new Mutex();

// 初始化日志
logger.info(`Jito URL: ${jitoUrl}`);
logger.info(`请求并发量: ${concurrency}/s`);

// const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 统计变量
let jitoRequestCount = 0; // 成功请求计数
let error429Count = 0; // 429 错误计数
let totalRequestCount = 0; // 总请求计数
let lastLogTime = Date.now(); // 上次日志输出时间

// 每 10 秒输出统计信息
async function logStatistics() {
  const now = Date.now();
  if (now - lastLogTime >= 10000) {
    const release = await statsMutex.acquire(); // 获取锁
    try {
      logger.warn(
        `统计 - 每 10 秒发送请求总量: ${totalRequestCount}, 成功请求量: ${jitoRequestCount}, 平均每秒: ${(
          jitoRequestCount / 10
        ).toFixed(1)}, 429 错误次数: ${error429Count}`
      );
      // 重置统计变量
      totalRequestCount = 0;
      jitoRequestCount = 0;
      error429Count = 0;
      lastLogTime = now;
    } finally {
      release(); // 释放锁
    }
  }
}

// 发送单个请求
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
      const release = await statsMutex.acquire(); // 获取锁
      try {
        jitoRequestCount++; // 成功请求计数
      } finally {
        release(); // 释放锁
      }
      const duration = Date.now() - start;
      // logger.info(`200: 请求成功, 耗时: ${duration}ms`);
    } else {
      logger.error(`请求失败, 状态码: ${bundle_resp.status}`);
    }
  } catch (error) {
    const duration = Date.now() - start;
    if (error.isAxiosError && error.response?.status === 429) {
      const release = await statsMutex.acquire(); // 获取锁
      try {
        error429Count++; // 429 错误计数
      } finally {
        release(); // 释放锁
      }
      // logger.error(`429: 请求过于频繁, 耗时: ${duration}ms`);
    } else {
      logger.error(`请求失败, 耗时: ${duration}ms, 错误: ${error.message}`);
    }
  }
}

// 主函数：控制请求发送频率
async function main() {
  const interval = 1000 / concurrency; // 每个请求的间隔时间

  function sendRequests() {
    for (let i = 0; i < concurrency; i++) {
      setTimeout(() => {
        limit(() =>
          run().catch((error) => {
            logger.error(`请求发生错误: ${error.message}`);
          })
        );
        (async () => {
          const release = await statsMutex.acquire(); // 获取锁
          try {
            totalRequestCount++; // 统计总请求量
          } finally {
            release(); // 释放锁
          }
        })();
      }, i * interval); // 均匀分布请求
    }
  }

  // 每秒执行一次请求发送
  setInterval(sendRequests, 1000);

  // 每 10 秒输出统计信息
  setInterval(logStatistics, 10000);
}

// 启动程序
main();
