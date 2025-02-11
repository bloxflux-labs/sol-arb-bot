import { PublicKey } from "@solana/web3.js";
import { connection } from "./connectionUtils";

let addressLookupTableCache: { [key: string]: any } = {}; // 缓存对象
let lastCacheUpdateTime = 0; // 上次缓存更新时间
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 缓存过期时间（1 小时）

export async function getAddressLookupTableWithCache(address: string) {
  // 检查缓存是否有效
  if (addressLookupTableCache[address] && Date.now() - lastCacheUpdateTime < CACHE_EXPIRE_TIME) {
    return addressLookupTableCache[address]; // 返回缓存内容
  }

  // 查询地址查找表
  const result = await connection.getAddressLookupTable(new PublicKey(address));
  if (result.value) {
    addressLookupTableCache[address] = result.value; // 更新缓存
    lastCacheUpdateTime = Date.now(); // 更新缓存时间
  }
  return result.value;
}

export async function getAddressLookupTables(addresses: string[]) {
  const addressLookupTableAccounts = await Promise.all(
    addresses.map(async (address) => {
      return await getAddressLookupTableWithCache(address);
    })
  );
  return addressLookupTableAccounts.filter((account) => account !== null); // 过滤掉无效的查找表
}
