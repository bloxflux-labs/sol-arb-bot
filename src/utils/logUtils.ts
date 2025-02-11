import { logger } from "../logger";

// 带耗时的日志输出
export function timedLog(message: string, startTime: number, lastStepTime?: number) {
  const elapsed = Date.now() - startTime;
  const stepTime = lastStepTime ? Date.now() - lastStepTime : 0;
  logger.info(
    `[总耗时 ${elapsed.toString().padStart(4, " ")}ms] ` +
      `[步骤耗时 ${stepTime.toString().padStart(4, " ")}ms] ${message}`
  );
  return Date.now(); // 返回当前时间作为下一步的lastStepTime
}
