//app/page.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "";

// WebSocket 재연결 설정
const WS_RECONNECT_INTERVAL = 3000; // 3초
const WS_MAX_RECONNECT_ATTEMPTS = 5;
const WS_HEALTHCHECK_INTERVAL = 15 * 60 * 1000; // 15분 (900초)

interface User {
  userid: string;
  email: string;
}

interface Channel {
  channelId: string;
  channelName: string;
  memberCount: number;
  createdAt: string;
  joined: boolean;
  myPermission: number | null; // 0: 오너, 1: 일반 멤버, null: 미가입
  myJoinOrder: number | null;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [createChannelName, setCreateChannelName] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true); // 마운트 상태 추적

  // 로그 추가 함수
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-99), `[${timestamp}] ${message}`]);
  }, []);

  // 재연결 타이머 정리
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // 헬스체크 타이머 정리
  const clearHealthCheckInterval = useCallback(() => {
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current);
      healthCheckIntervalRef.current = null;
    }
  }, []);

  // 토스트 메시지 표시 함수
  const showToast = useCallback((message: string, duration: number = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, duration);
  }, []);

  // 토스트 메시지 닫기
  const closeToast = useCallback(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(null);
  }, []);

  // 헬스체크 ping 전송
  const sendHealthCheckPing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const pingData = {
        event: "ping",
        data: { time: Date.now(), healthcheck: true },
      };
      wsRef.current.send(JSON.stringify(pingData));
      addLog("헬스체크 PING 전송");
    }
  }, [addLog]);

  // 로그아웃 함수 (useCallback 없이 일반 함수로)
  const handleLogout = () => {
    clearReconnectTimeout();

    if (wsRef.current) {
      wsRef.current.close(1000, "User logout");
      wsRef.current = null;
    }

    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch (error) {
      console.error("로컬 스토리지 정리 실패:", error);
    }

    setToken(null);
    setUser(null);
    setWsConnected(false);
    setLogs([]);
    setChannels([]);
    setReconnectAttempts(0);
    setIsReconnecting(false);
  };

  // 페이지 로드 시 저장된 토큰 확인
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem("token");
      const savedUser = localStorage.getItem("user");

      if (savedToken && savedUser) {
        const parsedUser = JSON.parse(savedUser);
        setToken(savedToken);
        setUser(parsedUser);
      }
    } catch (error) {
      console.error("저장된 인증 정보 로드 실패:", error);
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
  }, []);

  // WebSocket 연결 및 관리
  useEffect(() => {
    // 토큰이나 유저가 없으면 연결하지 않음
    if (!token || !user) {
      return;
    }

    // 환경 변수 검증
    if (!WS_URL) {
      addLog("WebSocket URL이 설정되지 않았습니다");
      return;
    }

    // 이미 연결 중이거나 연결된 상태면 무시
    if (
      wsRef.current?.readyState === WebSocket.CONNECTING ||
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    mountedRef.current = true;
    let currentReconnectAttempts = 0;

    const connect = () => {
      if (!mountedRef.current) {
        return;
      }

      // 이미 연결 중이거나 연결된 상태면 무시
      if (
        wsRef.current?.readyState === WebSocket.CONNECTING ||
        wsRef.current?.readyState === WebSocket.OPEN
      ) {
        return;
      }

      try {
        addLog("WebSocket 연결 시도...");
        const ws = new WebSocket(`${WS_URL}?token=${token}`);

        ws.onopen = () => {
          if (!mountedRef.current) {
            ws.close();
            return;
          }

          setWsConnected(true);
          setReconnectAttempts(0);
          setIsReconnecting(false);
          currentReconnectAttempts = 0;
          addLog("WebSocket 연결됨");

          // 연결 시 채널 목록 자동 요청 (서버에서 JWT로 유저 확인)
          const listData = {
            event: "listChannel",
            data: {
              time: Date.now(),
            },
          };
          ws.send(JSON.stringify(listData));

          // 헬스체크 인터벌 시작 (15분마다)
          clearHealthCheckInterval();
          healthCheckIntervalRef.current = setInterval(() => {
            sendHealthCheckPing();
          }, WS_HEALTHCHECK_INTERVAL);
          addLog(
            `헬스체크 인터벌 시작 (${WS_HEALTHCHECK_INTERVAL / 1000 / 60}분)`,
          );
        };

        ws.onmessage = (event) => {
          try {
            const { event: eventType, data } = JSON.parse(event.data);

            switch (eventType) {
              case "pong":
                addLog(`PONG 수신: ${JSON.stringify(data)}`);
                if (data.healthcheck) {
                  // 헬스체크 pong은 로그만
                  addLog("헬스체크 PONG 수신");
                } else {
                  showToast("🏓 PONG!", 2000);
                }
                break;
              case "systemmessage":
                addLog(`시스템 메시지: ${data.message}`);
                showToast(data.message, 3000);
                break;
              case "channelCreated":
                addLog(`채널 생성됨: ${data.channel || data.channelName}`);
                showToast(
                  `✅ 채널 "${data.channel || data.channelName}"이(가) 생성되었습니다.`,
                  3000,
                );
                // 채널 목록 갱신 요청
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      event: "listChannel",
                      data: { time: Date.now() },
                    }),
                  );
                }
                break;
              case "channelJoined":
                addLog(`채널 가입됨: ${data.channel || data.channelName}`);
                showToast(
                  `✅ 채널 "${data.channel || data.channelName}"에 가입되었습니다.`,
                  3000,
                );
                // 채널 목록 갱신 요청
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      event: "listChannel",
                      data: { time: Date.now() },
                    }),
                  );
                }
                break;
              case "channelQuitted":
                addLog(`채널 탈퇴됨: ${data.channel}`);
                showToast(`✅ 채널 "${data.channel}"에서 탈퇴했습니다.`, 3000);
                // 채널 목록 갱신 요청
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(
                    JSON.stringify({
                      event: "listChannel",
                      data: { time: Date.now() },
                    }),
                  );
                }
                break;
              case "channelList":
                addLog(`채널 목록 수신: ${data.channels?.length || 0}개`);
                setChannels(data.channels || []);
                break;
              case "error":
                addLog(
                  `에러: ${data.message} (원본 이벤트: ${data.originalEvent || "unknown"})`,
                );
                showToast(`❌ ${data.message}`, 4000);
                break;
              default:
                addLog(`이벤트 수신: ${eventType} - ${JSON.stringify(data)}`);
            }
          } catch (e) {
            addLog(
              `메시지 파싱 오류: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        };

        ws.onclose = (event) => {
          setWsConnected(false);
          wsRef.current = null;
          clearHealthCheckInterval();

          if (!mountedRef.current) {
            addLog("WebSocket 연결 종료 (컴포넌트 언마운트)");
            return;
          }

          // 인증 오류
          if (event.code === 1008) {
            addLog("WebSocket 인증 실패 - 다시 로그인해주세요");
            handleLogout();
            return;
          }

          // 정상 종료
          if (event.code === 1000) {
            addLog("WebSocket 연결 종료");
            return;
          }

          // 비정상 종료 - 재연결 시도
          addLog(`WebSocket 연결 끊김 (코드: ${event.code})`);

          currentReconnectAttempts++;
          if (currentReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
            addLog(
              `최대 재연결 시도 횟수(${WS_MAX_RECONNECT_ATTEMPTS}회) 초과`,
            );
            setIsReconnecting(false);
            return;
          }

          setIsReconnecting(true);
          setReconnectAttempts(currentReconnectAttempts);
          addLog(
            `재연결 시도 ${currentReconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS} (${WS_RECONNECT_INTERVAL / 1000}초 후)`,
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, WS_RECONNECT_INTERVAL);
        };

        ws.onerror = () => {
          addLog("WebSocket 오류 발생");
        };

        wsRef.current = ws;
      } catch (error) {
        addLog(
          `WebSocket 연결 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    // 초기 연결
    connect();

    // Cleanup
    return () => {
      mountedRef.current = false;
      clearReconnectTimeout();
      clearHealthCheckInterval();
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmount");
        wsRef.current = null;
      }
    };
  }, [
    token,
    user,
    addLog,
    clearReconnectTimeout,
    clearHealthCheckInterval,
    sendHealthCheckPing,
    showToast,
  ]);

  // Google 로그인 핸들러
  const handleGoogleLogin = () => {
    window.location.href = "/auth/google/login?platform=web";
  };

  // 채널 목록 요청
  const requestChannelList = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const listData = {
        event: "listChannel",
        data: {
          time: Date.now(),
        },
      };
      wsRef.current.send(JSON.stringify(listData));
      addLog("채널 목록 요청");
    }
  };

  // PING 전송
  const sendPing = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
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

  // 채널 생성
  const createChannel = () => {
    if (!createChannelName.trim()) {
      showToast("⚠️ 채널명을 입력해주세요.", 3000);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const createData = {
        event: "createChannel",
        data: {
          time: Date.now(),
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

  // 채널 가입
  const joinChannel = (channelName: string) => {
    if (!channelName.trim()) {
      showToast("⚠️ 채널명을 입력해주세요.", 3000);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const joinData = {
        event: "joinChannel",
        data: {
          time: Date.now(),
          channelName: channelName.trim(),
        },
      };
      wsRef.current.send(JSON.stringify(joinData));
      addLog(`채널 가입 요청: ${channelName}`);
    } else {
      addLog("WebSocket이 연결되지 않았습니다");
    }
  };

  // 채널 탈퇴
  const quitChannel = (channelName: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const quitData = {
        event: "quitChannel",
        data: {
          time: Date.now(),
          channel: channelName,
        },
      };
      wsRef.current.send(JSON.stringify(quitData));
      addLog(`채널 탈퇴 요청: ${channelName}`);
    } else {
      addLog("WebSocket이 연결되지 않았습니다");
    }
  };

  // 수동 재연결
  const manualReconnect = () => {
    if (token && user) {
      setReconnectAttempts(0);
      setIsReconnecting(false);
      // 기존 연결 정리
      if (wsRef.current) {
        wsRef.current.close(1000, "Manual reconnect");
        wsRef.current = null;
      }
      // 약간의 딜레이 후 재연결 (상태 업데이트 보장)
      setTimeout(() => {
        // token과 user가 변하지 않으므로 useEffect가 다시 실행되지 않음
        // 직접 연결을 시도해야 함
        if (!WS_URL) {
          addLog("WebSocket URL이 설정되지 않았습니다");
          return;
        }

        mountedRef.current = true;

        const ws = new WebSocket(`${WS_URL}?token=${token}`);

        ws.onopen = () => {
          if (!mountedRef.current) {
            ws.close();
            return;
          }
          setWsConnected(true);
          setReconnectAttempts(0);
          setIsReconnecting(false);
          addLog("WebSocket 연결됨 (수동 재연결)");

          // 채널 목록 요청 (서버에서 JWT로 유저 확인)
          ws.send(
            JSON.stringify({
              event: "listChannel",
              data: { time: Date.now() },
            }),
          );
        };

        ws.onmessage = (event) => {
          try {
            const { event: eventType, data } = JSON.parse(event.data);

            switch (eventType) {
              case "pong":
                addLog(`PONG 수신: ${JSON.stringify(data)}`);
                if (data.healthcheck) {
                  addLog("헬스체크 PONG 수신");
                } else {
                  showToast("🏓 PONG!", 2000);
                }
                break;
              case "systemmessage":
                addLog(`시스템 메시지: ${data.message}`);
                showToast(data.message, 3000);
                break;
              case "channelList":
                addLog(`채널 목록 수신: ${data.channels?.length || 0}개`);
                setChannels(data.channels || []);
                break;
              case "error":
                addLog(`에러: ${data.message}`);
                showToast(`❌ ${data.message}`, 4000);
                break;
              default:
                addLog(`이벤트 수신: ${eventType}`);
            }
          } catch (e) {
            addLog(`메시지 파싱 오류`);
          }
        };

        ws.onclose = (event) => {
          setWsConnected(false);
          wsRef.current = null;
          if (event.code === 1008) {
            addLog("WebSocket 인증 실패");
            handleLogout();
          } else {
            addLog(`WebSocket 연결 종료 (코드: ${event.code})`);
          }
        };

        ws.onerror = () => {
          addLog("WebSocket 오류 발생");
        };

        wsRef.current = ws;
      }, 100);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      {/* Toast 알림 (fixed position - 다른 요소 밀리지 않음) */}
      {toastMessage && (
        <div className="fixed top-0 left-0 right-0 z-50 animate-slide-down">
          <div className="bg-linear-to-r from-green-600 to-green-500 text-white px-4 py-3 shadow-lg">
            <div className="max-w-2xl mx-auto flex items-center justify-between">
              <span className="font-medium">{toastMessage}</span>
              <button
                onClick={closeToast}
                className="ml-4 hover:bg-green-700 rounded-full p-1 transition-colors"
                aria-label="닫기"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      wsConnected
                        ? "bg-green-500"
                        : isReconnecting
                          ? "bg-yellow-500 animate-pulse"
                          : "bg-red-500"
                    }`}
                  />
                  <span>
                    WebSocket:{" "}
                    {wsConnected
                      ? "연결됨"
                      : isReconnecting
                        ? `재연결 중 (${reconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS})`
                        : "연결 안됨"}
                  </span>
                </div>
                {!wsConnected && !isReconnecting && (
                  <button
                    onClick={manualReconnect}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors"
                  >
                    재연결
                  </button>
                )}
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
                    {channels.map((channel) => (
                      <li
                        key={channel.channelId}
                        className={`px-4 py-3 flex items-center justify-between hover:bg-gray-600 transition-colors ${
                          channel.joined ? "" : "cursor-pointer"
                        }`}
                        onClick={() =>
                          !channel.joined && joinChannel(channel.channelName)
                        }
                      >
                        <div className="flex flex-col">
                          <span
                            className={
                              channel.joined ? "text-lime-400" : "text-white"
                            }
                          >
                            {channel.channelName}
                            {channel.joined && (
                              <span className="ml-2 text-xs">
                                {channel.myPermission === 0
                                  ? "(오너)"
                                  : "(멤버)"}
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">
                            {channel.memberCount}명
                          </span>
                          {channel.joined && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                quitChannel(channel.channelName);
                              }}
                              className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                            >
                              탈퇴
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* 로그 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">로그</h3>
                <button
                  onClick={() => setLogs([])}
                  className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded text-sm transition-colors"
                >
                  지우기
                </button>
              </div>
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
