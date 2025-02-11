import { connection } from "./connectionUtils";

let cachedBlockhash: string | null = null; // 缓存的 blockhash
let cachedBlockhashTime = 0; // 缓存的 blockhash 获取时间
const BLOCKHASH_EXPIRE_TIME = 60 * 1000; // blockhash 有效期（1 分钟）

export async function getBlockhashWithCache() {
  // 检查缓存是否有效
  if (cachedBlockhash && Date.now() - cachedBlockhashTime < BLOCKHASH_EXPIRE_TIME) {
    return cachedBlockhash; // 返回缓存的 blockhash
  }

  // 获取最新的 blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  cachedBlockhash = blockhash; // 更新缓存
  cachedBlockhashTime = Date.now(); // 更新缓存时间
  return blockhash;
}
