import pino from "pino";

// 创建并导出日志实例
export const logger = pino({
  transport: {
    target: "pino-pretty",
    options: {
      ignore: "pid,hostname",
    },
  },
});
