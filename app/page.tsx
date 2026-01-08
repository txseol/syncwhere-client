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

interface Channel {
  channelname: string;
  users: string[];
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [systemMessage, setSystemMessage] = useState<string | null>(null);
  const [createChannelName, setCreateChannelName] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
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
      // 연결 시 채널 목록 자동 요청
      const listData = {
        event: "listChannel",
        data: {
          time: Date.now(),
          userid: user?.userid,
        },
      };
      ws.send(JSON.stringify(listData));
    };

    ws.onmessage = (event) => {
      try {
        const { event: eventType, data } = JSON.parse(event.data);

        if (eventType === "pong") {
          addLog(`PONG 수신: ${JSON.stringify(data)}`);
          alert("PONG!!!");
        } else if (eventType === "systemmessage") {
          addLog(`시스템 메시지: ${data.message}`);
          setSystemMessage(data.message);
          // 3초 후 시스템 메시지 자동 숨김
          setTimeout(() => setSystemMessage(null), 3000);
        } else if (eventType === "channelCreated") {
          addLog(`채널 생성됨: ${data.channelName}`);
          setSystemMessage(`채널 "${data.channelName}"이(가) 생성되었습니다.`);
          setTimeout(() => setSystemMessage(null), 3000);
          // 채널 목록 갱신
          requestChannelList();
        } else if (eventType === "channelJoined") {
          addLog(`채널 가입됨: ${data.channelName}`);
          setSystemMessage(`채널 "${data.channelName}"에 가입되었습니다.`);
          setTimeout(() => setSystemMessage(null), 3000);
          // 채널 목록 갱신
          requestChannelList();
        } else if (eventType === "channelList") {
          addLog(`채널 목록 수신: ${data.channels.length}개`);
          setChannels(data.channels || []);
        } else {
          addLog(`이벤트 수신: ${eventType} - ${JSON.stringify(data)}`);
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

  const createChannel = () => {
    if (!createChannelName.trim()) {
      setSystemMessage("채널명을 입력해주세요.");
      setTimeout(() => setSystemMessage(null), 3000);
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const createData = {
        event: "createChannel",
        data: {
          time: Date.now(),
          userid: user?.userid,
          channelName: createChannelName.trim(),
        },
      };
      wsRef.current.send(JSON.stringify(createData));
      addLog(`채널 생성 요청: ${createChannelName}`);
      setCreateChannelName("");
    } else {
      addLog("WebSocket이 연결되지 않았습니다");
    }
  };

  const joinChannel = (channelName: string) => {
    if (!channelName.trim()) {
      setSystemMessage("채널명을 입력해주세요.");
      setTimeout(() => setSystemMessage(null), 3000);
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const joinData = {
        event: "joinChannel",
        data: {
          time: Date.now(),
          userid: user?.userid,
          channelName: channelName.trim(),
        },
      };
      wsRef.current.send(JSON.stringify(joinData));
      addLog(`채널 가입 요청: ${channelName}`);
    } else {
      addLog("WebSocket이 연결되지 않았습니다");
    }
  };

  const requestChannelList = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const listData = {
        event: "listChannel",
        data: {
          time: Date.now(),
          userid: user?.userid,
        },
      };
      wsRef.current.send(JSON.stringify(listData));
      addLog("채널 목록 요청");
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

            {/* 시스템 메시지 */}
            {systemMessage && (
              <div className="bg-yellow-600 text-white rounded-lg p-4 text-center font-semibold animate-pulse">
                {systemMessage}
              </div>
            )}

            {/* 채널 생성 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="font-semibold mb-3">채널 생성</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createChannelName}
                  onChange={(e) => setCreateChannelName(e.target.value)}
                  placeholder="생성할 채널명 입력"
                  disabled={!wsConnected}
                  className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                  onKeyDown={(e) => e.key === "Enter" && createChannel()}
                />
                <button
                  onClick={createChannel}
                  disabled={!wsConnected}
                  className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
                    wsConnected
                      ? "bg-green-600 hover:bg-green-700"
                      : "bg-gray-600 cursor-not-allowed"
                  }`}
                >
                  생성
                </button>
              </div>
            </div>

            {/* 채널 목록 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">채널 목록</h3>
                <button
                  onClick={requestChannelList}
                  disabled={!wsConnected}
                  className={`px-4 py-1 rounded text-sm transition-colors ${
                    wsConnected
                      ? "bg-gray-600 hover:bg-gray-500"
                      : "bg-gray-700 cursor-not-allowed"
                  }`}
                >
                  새로고침
                </button>
              </div>
              <div className="bg-gray-700 rounded-lg max-h-48 overflow-y-auto">
                {channels.length === 0 ? (
                  <p className="text-gray-400 text-center py-4">
                    채널이 없습니다
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-600">
                    {channels.map((channel, index) => {
                      const isJoined = channel.users.includes(
                        user?.userid || ""
                      );
                      return (
                        <li
                          key={index}
                          className={`px-4 py-3 flex items-center justify-between hover:bg-gray-600 transition-colors ${
                            isJoined ? "" : "cursor-pointer"
                          }`}
                          onClick={() =>
                            !isJoined && joinChannel(channel.channelname)
                          }
                        >
                          <span
                            className={
                              isJoined ? "text-lime-400" : "text-white"
                            }
                          >
                            {isJoined
                              ? `'${channel.channelname}' - 가입됨`
                              : channel.channelname}
                          </span>
                          <span className="text-gray-400 text-sm">
                            {channel.users.length}명
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
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
