// server.mjs - Next.js 커스텀 서버 (로깅 포함)
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import fs from "fs";
import path from "path";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3001", 10);

// 로그 파일 설정
const getLogFileName = () => {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `log_${dateStr}.txt`;
};

const logDir = process.cwd();
const logFileName = getLogFileName();
const logFilePath = path.join(logDir, logFileName);

// 로그 스트림 생성
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

// 로그 함수
const log = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  const logEntry = data
    ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}`
    : `[${timestamp}] [${level}] ${message}`;

  console.log(logEntry);
  logStream.write(logEntry + "\n");
};

// 콘솔 출력 오버라이드 (서버 시작 전)
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

console.log = (...args) => {
  const message = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : a))
    .join(" ");
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [INFO] ${message}`;
  originalConsoleLog(logEntry);
  logStream.write(logEntry + "\n");
};

console.error = (...args) => {
  const message = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : a))
    .join(" ");
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [ERROR] ${message}`;
  originalConsoleError(logEntry);
  logStream.write(logEntry + "\n");
};

console.warn = (...args) => {
  const message = args
    .map((a) => (typeof a === "object" ? JSON.stringify(a) : a))
    .join(" ");
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [WARN] ${message}`;
  originalConsoleWarn(logEntry);
  logStream.write(logEntry + "\n");
};

log("INFO", "=".repeat(60));
log("INFO", "SyncWhere Browser Client 서버 시작");
log("INFO", `로그 파일: ${logFilePath}`);
log("INFO", `환경: ${dev ? "development" : "production"}`);
log("INFO", `포트: ${port}`);
log("INFO", "=".repeat(60));

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      const { pathname, query } = parsedUrl;

      // 요청 로깅 (간략하게)
      const clientIp =
        req.headers["x-forwarded-for"] || req.socket.remoteAddress;
      const userAgent = req.headers["user-agent"] || "unknown";

      // 정적 자원은 로깅 제외 (선택적)
      const isStaticAsset =
        pathname.startsWith("/_next/") ||
        pathname.startsWith("/favicon") ||
        pathname.endsWith(".js") ||
        pathname.endsWith(".css") ||
        pathname.endsWith(".map");

      if (!isStaticAsset) {
        log("REQ", `${req.method} ${pathname}`, {
          ip: clientIp,
          query: Object.keys(query).length > 0 ? query : undefined,
          ua: userAgent.substring(0, 50), // User-Agent 50자로 제한
        });
      }

      // 응답 완료 로깅
      const startTime = Date.now();
      res.on("finish", () => {
        if (!isStaticAsset) {
          const duration = Date.now() - startTime;
          log(
            "RES",
            `${req.method} ${pathname} ${res.statusCode} ${duration}ms`,
          );
        }
      });

      await handle(req, res, parsedUrl);
    } catch (err) {
      log("ERROR", `요청 처리 실패: ${req.url}`, {
        error: err.message,
        stack: err.stack,
      });
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  })
    .once("error", (err) => {
      log("ERROR", "서버 시작 실패", { error: err.message });
      process.exit(1);
    })
    .listen(port, hostname, () => {
      log("INFO", `서버 준비 완료 - http://${hostname}:${port}`);
      log("INFO", "로그 파일에 요청/응답이 기록됩니다");
    });
});

// 프로세스 종료 처리
const gracefulShutdown = (signal) => {
  log("INFO", `${signal} 시그널 수신, 서버 종료 중...`);
  logStream.end(() => {
    log("INFO", "로그 스트림 종료");
    process.exit(0);
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// 미처리 예외 핸들링
process.on("uncaughtException", (err) => {
  log("ERROR", "미처리 예외 발생", { error: err.message, stack: err.stack });
});

process.on("unhandledRejection", (reason, promise) => {
  log("ERROR", "미처리 Promise 거부", { reason: String(reason) });
});
