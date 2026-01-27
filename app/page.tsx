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

interface Document {
  docId: string;
  channelId: string;
  name: string;
  dir: string;
  depth: number;
  createdAt: string;
  snapshotVersion: number;
}

// 트리 노드 인터페이스
interface TreeNode {
  name: string;
  path: string;
  depth: number;
  isFolder: boolean;
  children: TreeNode[];
  doc?: Document;
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
  const [showLogs, setShowLogs] = useState(false);

  // 채널 입장 상태
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["root"]),
  );

  // 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetPath: string;
    targetDepth: number;
  } | null>(null);

  // 새 항목 생성 모달
  const [createModal, setCreateModal] = useState<{
    type: "folder" | "document";
    dir: string;
    depth: number;
  } | null>(null);
  const [newItemName, setNewItemName] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

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

  // 로그아웃 함수
  const handleLogout = () => {
    console.log("[Home] 로그아웃 시작");
    clearReconnectTimeout();
    clearHealthCheckInterval();

    if (wsRef.current) {
      wsRef.current.close(1000, "User logout");
      wsRef.current = null;
    }

    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      console.log("[Home] 로컬 스토리지 정리 완료");
    } catch (error) {
      console.error("[Home] 로컬 스토리지 정리 실패:", error);
    }

    setToken(null);
    setUser(null);
    setWsConnected(false);
    setLogs([]);
    setChannels([]);
    setCurrentChannel(null);
    setDocuments([]);
    setReconnectAttempts(0);
    setIsReconnecting(false);
    console.log("[Home] 로그아웃 완료");
  };

  // 문서 목록을 트리 구조로 변환
  const buildDocumentTree = useCallback((docs: Document[]): TreeNode => {
    const root: TreeNode = {
      name: "root",
      path: "root",
      depth: 0,
      isFolder: true,
      children: [],
    };

    const folderMap = new Map<string, TreeNode>();
    folderMap.set("root", root);

    // 모든 폴더 경로 수집
    const folderPaths = new Set<string>();
    docs.forEach((doc) => {
      if (doc.dir !== "root") {
        const parts = doc.dir.split("/");
        let currentPath = "";
        for (let i = 0; i < parts.length; i++) {
          currentPath = i === 0 ? parts[i] : `${currentPath}/${parts[i]}`;
          if (currentPath !== "root") {
            folderPaths.add(currentPath);
          }
        }
      }
    });

    // 폴더 노드 생성
    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) => {
      return a.split("/").length - b.split("/").length;
    });

    sortedFolderPaths.forEach((folderPath) => {
      const parts = folderPath.split("/");
      const folderName = parts[parts.length - 1];
      const parentPath =
        parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
      const depth = parts.length;

      const folderNode: TreeNode = {
        name: folderName,
        path: folderPath,
        depth: depth,
        isFolder: true,
        children: [],
      };

      folderMap.set(folderPath, folderNode);
      const parentNode = folderMap.get(parentPath);
      if (parentNode) {
        parentNode.children.push(folderNode);
      }
    });

    // 문서를 해당 폴더에 추가
    docs.forEach((doc) => {
      if (doc.name === ".option") return; // 폴더 마커 숨김

      const parentNode = folderMap.get(doc.dir);
      if (parentNode) {
        parentNode.children.push({
          name: doc.name,
          path: `${doc.dir}/${doc.name}`,
          depth: doc.depth,
          isFolder: false,
          children: [],
          doc: doc,
        });
      }
    });

    // 정렬 (폴더 먼저, 이름순)
    const sortChildren = (node: TreeNode) => {
      node.children.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortChildren);
    };
    sortChildren(root);

    return root;
  }, []);

  // 페이지 로드 시 저장된 토큰 확인
  useEffect(() => {
    console.log("[Home] 페이지 로드됨, 저장된 인증 정보 확인");
    try {
      const savedToken = localStorage.getItem("token");
      const savedUser = localStorage.getItem("user");

      if (savedToken && savedUser) {
        const parsedUser = JSON.parse(savedUser);
        console.log("[Home] 저장된 사용자:", parsedUser.email);
        setToken(savedToken);
        setUser(parsedUser);
      } else {
        console.log("[Home] 저장된 인증 정보 없음");
      }
    } catch (error) {
      console.error("[Home] 저장된 인증 정보 로드 실패:", error);
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    }
  }, []);

  // WebSocket 연결 및 관리
  useEffect(() => {
    // 토큰이나 유저가 없으면 연결하지 않음
    if (!token || !user) {
      console.log("[Home] 토큰/유저 없음, WebSocket 연결 안함");
      return;
    }

    // 환경 변수 검증
    if (!WS_URL) {
      console.error("[Home] WS_URL 환경변수 미설정");
      addLog("WebSocket URL이 설정되지 않았습니다");
      return;
    }

    // 이미 연결 중이거나 연결된 상태면 무시
    if (
      wsRef.current?.readyState === WebSocket.CONNECTING ||
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      console.log("[Home] 이미 WebSocket 연결됨/연결중");
      return;
    }

    console.log("[Home] WebSocket 연결 시작, URL:", WS_URL);
    mountedRef.current = true;
    let currentReconnectAttempts = 0;

    const connect = () => {
      if (!mountedRef.current) {
        console.log("[Home] 컴포넌트 언마운트됨, 연결 취소");
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
        console.log("[Home] WebSocket 연결 시도...");
        addLog("WebSocket 연결 시도...");
        const ws = new WebSocket(`${WS_URL}?token=${token}`);

        ws.onopen = () => {
          if (!mountedRef.current) {
            ws.close();
            return;
          }

          console.log("[Home] WebSocket 연결 성공");
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
              case "docList":
                addLog(`문서 목록 수신: ${data.documents?.length || 0}개`);
                setDocuments(data.documents || []);
                break;
              case "docCreated":
                addLog(`문서 생성됨: ${data.document?.name}`);
                showToast(`✅ "${data.document?.name}" 생성됨`, 3000);
                // 문서 목록에 추가
                if (data.document) {
                  setDocuments((prev) => [...prev, data.document]);
                }
                break;
              case "docDeleted":
                addLog(`문서 삭제됨: docId=${data.docId}`);
                showToast(`🗑️ 문서가 삭제되었습니다.`, 3000);
                // 문서 목록에서 제거
                setDocuments((prev) =>
                  prev.filter((d) => d.docId !== data.docId),
                );
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
          console.log(
            "[Home] WebSocket 연결 종료, 코드:",
            event.code,
            "이유:",
            event.reason,
          );
          setWsConnected(false);
          wsRef.current = null;
          clearHealthCheckInterval();

          if (!mountedRef.current) {
            addLog("WebSocket 연결 종료 (컴포넌트 언마운트)");
            return;
          }

          // 인증 오류
          if (event.code === 1008) {
            console.error("[Home] WebSocket 인증 실패");
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
          console.warn("[Home] WebSocket 비정상 종료, 재연결 시도");
          addLog(`WebSocket 연결 끊김 (코드: ${event.code})`);

          currentReconnectAttempts++;
          if (currentReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
            console.error("[Home] 최대 재연결 시도 횟수 초과");
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

        ws.onerror = (error) => {
          console.error("[Home] WebSocket 오류:", error);
          addLog("WebSocket 오류 발생");
        };

        wsRef.current = ws;
      } catch (error) {
        console.error("[Home] WebSocket 연결 실패:", error);
        addLog(
          `WebSocket 연결 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    // 초기 연결
    connect();

    // Cleanup
    return () => {
      console.log("[Home] 컴포넌트 언마운트, WebSocket 정리");
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

  // 채널 입장 (문서 목록 조회)
  const enterChannel = (channel: Channel) => {
    setCurrentChannel(channel);
    setDocuments([]);
    setExpandedFolders(new Set(["root"]));

    // 문서 목록 요청
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "listDoc",
          data: {
            time: Date.now(),
            channelId: channel.channelId,
          },
        }),
      );
      addLog(`문서 목록 요청: ${channel.channelName}`);
    }
  };

  // 채널 나가기 (목록으로 돌아가기)
  const leaveChannel = () => {
    setCurrentChannel(null);
    setDocuments([]);
    setExpandedFolders(new Set(["root"]));
    setContextMenu(null);
    setCreateModal(null);
  };

  // 폴더 토글
  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // 우클릭 컨텍스트 메뉴
  const handleContextMenu = (
    e: React.MouseEvent,
    targetPath: string,
    targetDepth: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetPath,
      targetDepth,
    });
  };

  // 컨텍스트 메뉴 닫기
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // 생성 모달 열기
  const openCreateModal = (type: "folder" | "document") => {
    if (!contextMenu) return;
    setCreateModal({
      type,
      dir: contextMenu.targetPath,
      depth: contextMenu.targetDepth + 1,
    });
    setNewItemName("");
    setContextMenu(null);
  };

  // 폴더 생성
  const createFolder = () => {
    if (!createModal || !currentChannel || !newItemName.trim()) return;

    const folderPath =
      createModal.dir === "root"
        ? newItemName.trim()
        : `${createModal.dir}/${newItemName.trim()}`;

    // .option 문서 생성으로 폴더 마킹
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "createDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docName: ".option",
            dir: folderPath,
            depth: createModal.depth,
          },
        }),
      );
      addLog(`폴더 생성 요청: ${folderPath}`);
    }

    setCreateModal(null);
    setNewItemName("");
  };

  // 문서 생성
  const createDocument = () => {
    if (!createModal || !currentChannel || !newItemName.trim()) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "createDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docName: newItemName.trim(),
            dir: createModal.dir,
            depth: createModal.depth,
          },
        }),
      );
      addLog(`문서 생성 요청: ${createModal.dir}/${newItemName.trim()}`);
    }

    setCreateModal(null);
    setNewItemName("");
  };

  // 문서 삭제
  const deleteDocument = (docId: string) => {
    if (!currentChannel) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "deleteDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docId,
          },
        }),
      );
      addLog(`문서 삭제 요청: docId=${docId}`);
    }
  };

  // 폴더 삭제 (하위 모든 문서 삭제)
  const deleteFolder = (folderPath: string) => {
    if (!currentChannel) return;

    // 해당 폴더와 하위의 모든 문서 찾기
    const docsToDelete = documents.filter(
      (doc) => doc.dir === folderPath || doc.dir.startsWith(`${folderPath}/`),
    );

    docsToDelete.forEach((doc) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "deleteDoc",
            data: {
              time: Date.now(),
              channelId: currentChannel.channelId,
              docId: doc.docId,
            },
          }),
        );
      }
    });

    addLog(`폴더 삭제 요청: ${folderPath} (${docsToDelete.length}개 문서)`);
  };

  // 트리 노드 렌더링
  const renderTreeNode = (
    node: TreeNode,
    level: number = 0,
  ): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const paddingLeft = level * 16;

    if (node.isFolder) {
      return (
        <div key={node.path}>
          <div
            className="flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer select-none"
            style={{ paddingLeft: `${paddingLeft + 8}px` }}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => handleContextMenu(e, node.path, node.depth)}
          >
            <span className="mr-1 text-xs text-gray-400">
              {isExpanded ? "▼" : "▶"}
            </span>
            <span className="mr-1">📁</span>
            <span className="text-sm text-gray-200 truncate">{node.name}</span>
          </div>
          {isExpanded && (
            <div>
              {node.children.map((child) => renderTreeNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className="flex items-center py-1 px-2 hover:bg-gray-700 cursor-pointer select-none group"
        style={{ paddingLeft: `${paddingLeft + 20}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 문서 삭제 확인
          if (node.doc && confirm(`"${node.name}" 문서를 삭제하시겠습니까?`)) {
            deleteDocument(node.doc.docId);
          }
        }}
      >
        <span className="mr-1">📄</span>
        <span className="text-sm text-gray-300 truncate flex-1">
          {node.name}
        </span>
      </div>
    );
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
    <div
      className="h-screen bg-gray-900 text-white flex"
      onClick={closeContextMenu}
    >
      {/* Toast 알림 */}
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

      {/* 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => openCreateModal("folder")}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            📁 새 폴더
          </button>
          <button
            onClick={() => openCreateModal("document")}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
          >
            📄 새 문서
          </button>
          {contextMenu.targetPath !== "root" && (
            <>
              <div className="border-t border-gray-600 my-1" />
              <button
                onClick={() => {
                  if (
                    confirm(
                      `"${contextMenu.targetPath}" 폴더를 삭제하시겠습니까?\n(하위 모든 내용이 삭제됩니다)`,
                    )
                  ) {
                    deleteFolder(contextMenu.targetPath);
                  }
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2"
              >
                🗑️ 폴더 삭제
              </button>
            </>
          )}
        </div>
      )}

      {/* 생성 모달 */}
      {createModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className="bg-gray-800 rounded-lg p-6 w-96 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4">
              {createModal.type === "folder" ? "📁 새 폴더" : "📄 새 문서"}
            </h3>
            <p className="text-sm text-gray-400 mb-2">
              위치: {createModal.dir}
            </p>
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder={
                createModal.type === "folder" ? "폴더명 입력" : "문서명 입력"
              }
              className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  createModal.type === "folder"
                    ? createFolder()
                    : createDocument();
                } else if (e.key === "Escape") {
                  setCreateModal(null);
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreateModal(null)}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={
                  createModal.type === "folder" ? createFolder : createDocument
                }
                disabled={!newItemName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                생성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 좌측 사이드바 */}
      <div className="w-72 bg-gray-800 border-r border-gray-700 flex flex-col">
        {!user ? (
          /* 로그인 전 */
          <div className="flex-1 flex flex-col items-center justify-center p-4">
            <h1 className="text-xl font-bold mb-6">SyncWhere</h1>
            <p className="text-gray-400 mb-4 text-sm text-center">
              로그인하여 시작하세요
            </p>
            <button
              onClick={handleGoogleLogin}
              className="flex items-center gap-2 bg-white text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-100 transition-colors text-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
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
        ) : currentChannel ? (
          /* 채널 입장 후: 문서 트리 */
          <div className="flex flex-col h-full">
            {/* 채널 헤더 */}
            <div className="p-3 border-b border-gray-700 flex items-center gap-2">
              <button
                onClick={leaveChannel}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
                title="채널 목록으로"
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
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <span className="font-semibold truncate flex-1">
                {currentChannel.channelName}
              </span>
            </div>

            {/* 문서 트리 */}
            <div
              className="flex-1 overflow-y-auto"
              onContextMenu={(e) => handleContextMenu(e, "root", 0)}
            >
              {documents.length === 0 ? (
                <div className="p-4 text-gray-400 text-sm text-center">
                  <p>문서가 없습니다</p>
                  <p className="text-xs mt-1">우클릭하여 생성</p>
                </div>
              ) : (
                <div className="py-2">
                  {buildDocumentTree(documents).children.map((child) =>
                    renderTreeNode(child, 0),
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* 채널 목록 */
          <div className="flex flex-col h-full">
            {/* 사용자 정보 헤더 */}
            <div className="p-3 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${wsConnected ? "bg-green-500" : isReconnecting ? "bg-yellow-500 animate-pulse" : "bg-red-500"}`}
                  />
                  <span className="text-sm truncate">{user.email}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs text-red-400 hover:text-red-300 shrink-0"
                >
                  로그아웃
                </button>
              </div>
            </div>

            {/* 채널 생성 */}
            <div className="p-3 border-b border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={createChannelName}
                  onChange={(e) => setCreateChannelName(e.target.value)}
                  placeholder="새 채널명"
                  disabled={!wsConnected}
                  className="flex-1 bg-gray-700 text-white px-3 py-1.5 rounded text-sm focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50"
                  onKeyDown={(e) => e.key === "Enter" && createChannel()}
                />
                <button
                  onClick={createChannel}
                  disabled={!wsConnected || !createChannelName.trim()}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded text-sm transition-colors"
                >
                  생성
                </button>
              </div>
            </div>

            {/* 가입된 채널 */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-2">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-xs text-gray-400 font-semibold uppercase">
                    가입된 채널
                  </span>
                  <button
                    onClick={requestChannelList}
                    disabled={!wsConnected}
                    className="text-xs text-gray-400 hover:text-white disabled:cursor-not-allowed"
                  >
                    새로고침
                  </button>
                </div>
                {channels.filter((c) => c.joined).length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">
                    가입된 채널이 없습니다
                  </p>
                ) : (
                  channels
                    .filter((c) => c.joined)
                    .map((channel) => (
                      <div
                        key={channel.channelId}
                        className="flex items-center justify-between px-2 py-2 hover:bg-gray-700 rounded cursor-pointer group"
                        onClick={() => enterChannel(channel)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lime-400">📂</span>
                          <span className="truncate">
                            {channel.channelName}
                          </span>
                          <span className="text-xs text-gray-500">
                            {channel.myPermission === 0 ? "(오너)" : ""}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            quitChannel(channel.channelName);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition-opacity"
                        >
                          탈퇴
                        </button>
                      </div>
                    ))
                )}
              </div>

              {/* 미가입 채널 */}
              <div className="p-2 border-t border-gray-700">
                <span className="text-xs text-gray-400 font-semibold uppercase px-2">
                  다른 채널
                </span>
                {channels.filter((c) => !c.joined).length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-4">
                    가입 가능한 채널이 없습니다
                  </p>
                ) : (
                  channels
                    .filter((c) => !c.joined)
                    .map((channel) => (
                      <div
                        key={channel.channelId}
                        className="flex items-center justify-between px-2 py-2 hover:bg-gray-700 rounded cursor-pointer"
                        onClick={() => joinChannel(channel.channelName)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-gray-400">📁</span>
                          <span className="truncate text-gray-300">
                            {channel.channelName}
                          </span>
                        </div>
                        <span className="text-xs text-gray-500">
                          {channel.memberCount}명
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* 로그 토글 */}
            <div className="border-t border-gray-700">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full px-3 py-2 text-left text-sm text-gray-400 hover:bg-gray-700 flex items-center justify-between"
              >
                <span>로그 {logs.length > 0 && `(${logs.length})`}</span>
                <span>{showLogs ? "▼" : "▶"}</span>
              </button>
              {showLogs && (
                <div className="px-2 pb-2">
                  <div className="bg-black rounded p-2 h-32 overflow-y-auto font-mono text-xs">
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
                  <button
                    onClick={() => setLogs([])}
                    className="mt-1 text-xs text-gray-500 hover:text-gray-300"
                  >
                    지우기
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 우측 메인 영역 */}
      <div className="flex-1 flex flex-col">
        {!user ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <h2 className="text-2xl font-bold mb-2">SyncWhere</h2>
              <p>실시간 문서 협업 플랫폼</p>
            </div>
          </div>
        ) : !currentChannel ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-lg">채널을 선택하세요</p>
              <p className="text-sm mt-2">
                좌측에서 가입된 채널을 클릭하여 입장합니다
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-lg">문서 편집 영역</p>
              <p className="text-sm mt-2">좌측에서 문서를 선택하세요</p>
              <p className="text-xs mt-4 text-gray-600">
                (추후 편집기 구현 예정)
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
