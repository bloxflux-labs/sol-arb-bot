import express, { Request, Response } from "express";

const app = express();
const port = 8082;

app.use(express.json());

app.post("/api/v1/bundles", (req: Request, res: Response) => {
  // 获取客户端的源 IP 地址
  const clientIp = req.ip || req.connection.remoteAddress;
  console.log(`Received request from IP: ${clientIp}`);
  res.status(200).send(`Request received from IP: ${clientIp}`);
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API server is running on http://0.0.0.0:${port}`);
});
