import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

// 固定的加密密钥（可以是任意长度，代码会自动处理）
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY is not defined in environment variables");
}

// 确保密钥长度为 32 字节，并增加盐值
const getValidKey = (key: string): Buffer => {
  const salt = "Atw16bzw+aT^_C^p"; // 固定的盐值
  return crypto
    .createHash("sha256")
    .update(key + salt)
    .digest();
};

// AES 加密函数
export const encrypt = (text: string): string => {
  const key = getValidKey(ENCRYPTION_KEY);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, Buffer.alloc(16, 0));
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

// AES 解密函数
export const decrypt = (encrypted: string): string => {
  const key = getValidKey(ENCRYPTION_KEY);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.alloc(16, 0));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};
