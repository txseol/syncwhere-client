"use client";

import { useEffect, useState, useRef } from "react";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;
const REDIRECT_URI = process.env.NEXT_PUBLIC_REDIRECT_URI!;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const WS_URL = process.env.NEXT_PUBLIC_WS_URL!;

interface User {
  userid: string;
  email: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // 페이지 로드 시 저장된 토큰 확인
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");

    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // 토큰이 있으면 WebSocket 연결
  useEffect(() => {
    if (token && !wsRef.current) {
      connectWebSocket(token);
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token]);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const connectWebSocket = (authToken: string) => {
    const ws = new WebSocket(`${WS_URL}?token=${authToken}`);

    ws.onopen = () => {
      setWsConnected(true);
      addLog("WebSocket 연결됨");
    };

    ws.onmessage = (event) => {
      try {
        const { event: eventType, data } = JSON.parse(event.data);

        if (eventType === "pong") {
          addLog(`PONG 수신: ${JSON.stringify(data)}`);
          alert("PONG!!!");
        }
      } catch (e) {
        addLog(`메시지 파싱 오류: ${e}`);
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      addLog("WebSocket 연결 종료");
      wsRef.current = null;
    };

    ws.onerror = () => {
      addLog("WebSocket 오류 발생");
    };

    wsRef.current = ws;
  };

  const handleGoogleLogin = () => {
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    googleAuthUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "email profile");
    googleAuthUrl.searchParams.set("access_type", "offline");

    window.location.href = googleAuthUrl.toString();
  };

  const handleLogout = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
    setWsConnected(false);
    setLogs([]);
  };

  const sendPing = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const pingData = {
        event: "ping",
        data: { user: user?.userid, time: Date.now() },
      };
      wsRef.current.send(JSON.stringify(pingData));
      addLog("PING 전송");
    } else {
      addLog("WebSocket이 연결되지 않았습니다");
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-center">SyncWhere</h1>

        {!user ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-gray-400 mb-4">로그인하여 시작하세요</p>
            <button
              onClick={handleGoogleLogin}
              className="flex items-center gap-3 bg-white text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google로 로그인
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 사용자 정보 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">로그인됨</p>
                  <p className="font-semibold">{user.email}</p>
                </div>
                <button
                  onClick={handleLogout}
                  className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  로그아웃
                </button>
              </div>
            </div>

            {/* WebSocket 상태 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className={`w-3 h-3 rounded-full ${
                    wsConnected ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <span>WebSocket: {wsConnected ? "연결됨" : "연결 안됨"}</span>
              </div>

              <button
                onClick={sendPing}
                disabled={!wsConnected}
                className={`w-full py-3 rounded-lg font-semibold transition-colors ${
                  wsConnected
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-gray-600 cursor-not-allowed"
                }`}
              >
                PING 전송
              </button>
            </div>

            {/* 로그 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">로그</h3>
              <div className="bg-black rounded p-3 h-48 overflow-y-auto font-mono text-sm">
                {logs.length === 0 ? (
                  <p className="text-gray-500">로그가 없습니다</p>
                ) : (
                  logs.map((log, index) => (
                    <p key={index} className="text-green-400">
                      {log}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
