//app/page.tsx
"use client";

import { useEffect, useState, useRef, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "";

// WebSocket 재연결 설정
const WS_RECONNECT_INTERVAL = 3000; // 3초
const WS_MAX_RECONNECT_ATTEMPTS = 5;
const WS_HEALTHCHECK_INTERVAL = 15 * 60 * 1000; // 15분 (900초)

interface User {
  id: string; // 내부 UUID (editedBy와 비교용)
  userid: string; // Google ID
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
  status?: number; // 0: 정상, 1: 삭제됨, 2: 잠금
  content?: string;
}

// 문서 상태 상수
const DOC_STATUS = {
  NORMAL: 0, // 정상
  DELETED: 1, // 삭제됨
  LOCKED: 2, // 잠금
} as const;

// 온라인 유저 인터페이스
interface OnlineUser {
  id: string;
  email: string;
  currentDoc?: string | null;
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
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isChannelConnected, setIsChannelConnected] = useState(false);
  const [channelLogs, setChannelLogs] = useState<string[]>([]);
  const [showChannelLogs, setShowChannelLogs] = useState(true);

  // 문서 열람 상태
  const [currentDoc, setCurrentDoc] = useState<Document | null>(null);
  const [docContent, setDocContent] = useState<string>("");
  const [docStatus, setDocStatus] = useState<number>(DOC_STATUS.NORMAL);
  const [docViewers, setDocViewers] = useState<OnlineUser[]>([]);
  const [isDocLoading, setIsDocLoading] = useState(false);
  const [localVersion, setLocalVersion] = useState<string>("1.0.0");

  // 드래그앤드랍 상태
  const [dragItem, setDragItem] = useState<{
    type: "folder" | "document";
    path: string;
    doc?: Document;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // 이름 변경 모달 상태
  const [renameModal, setRenameModal] = useState<{
    type: "folder" | "document";
    oldName: string;
    oldPath: string;
    doc?: Document;
  } | null>(null);
  const [newName, setNewName] = useState("");

  // 컨텍스트 메뉴 상태
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetPath: string;
    targetDepth: number;
    isFolder: boolean;
    doc?: Document;
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
  const currentDocRef = useRef<Document | null>(null); // 현재 문서 참조 (클로저 문제 해결용)

  // 로그 추가 함수
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-99), `[${timestamp}] ${message}`]);
  }, []);

  // 채널 로그 추가 함수
  const addChannelLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setChannelLogs((prev) => [...prev.slice(-99), `[${timestamp}] ${message}`]);
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

  // 문서의 전체 경로 계산 (서버의 dir은 직속 상위 디렉토리명만)
  // depth를 기반으로 트리 구조를 재구성
  const buildDocumentTree = useCallback((docs: Document[]): TreeNode => {
    const root: TreeNode = {
      name: "root",
      path: "root",
      depth: -1, // root 자체는 depth -1 (root 안의 항목이 depth 0)
      isFolder: true,
      children: [],
    };

    const folderMap = new Map<string, TreeNode>();
    folderMap.set("root", root);

    // depth별로 문서 그룹화 (낮은 depth부터 처리)
    const docsByDepth = new Map<number, Document[]>();
    docs.forEach((doc) => {
      if (!docsByDepth.has(doc.depth)) {
        docsByDepth.set(doc.depth, []);
      }
      docsByDepth.get(doc.depth)!.push(doc);
    });

    // depth 순서대로 정렬
    const sortedDepths = Array.from(docsByDepth.keys()).sort((a, b) => a - b);

    // depth별로 폴더와 문서 처리
    sortedDepths.forEach((depth) => {
      const docsAtDepth = docsByDepth.get(depth) || [];

      // .option 파일을 폴더로 처리 (name=".option"이면 dir이 폴더명)
      docsAtDepth.forEach((doc) => {
        if (doc.name === ".option") {
          // depth=0이고 dir="root"인 경우는 root 폴더 자체이므로 표시하지 않음
          if (depth === 0 && doc.dir === "root") {
            return; // root 폴더는 스킵
          }

          // 폴더 노드 생성 - doc.dir이 폴더명
          const folderName = doc.dir;

          // depth 0이면 root 아래에 폴더가 있음 (root 폴더 자체 제외)
          // depth 1 이상이면 상위 폴더 찾기 필요
          let parentNode: TreeNode | undefined;
          if (depth === 0) {
            // root 아래에 폴더 생성 (depth 0인 일반 폴더)
            parentNode = root;
          } else if (depth === 1) {
            // depth 1인 폴더는 root 아래에 있음
            parentNode = root;
          } else {
            // depth 2 이상인 경우 상위 폴더 찾기
            folderMap.forEach((node) => {
              if (node.depth === depth - 1 && node.isFolder) {
                parentNode = node;
              }
            });
            // parentNode를 찾지 못한 경우 root에 추가
            if (!parentNode) parentNode = root;
          }

          // 폴더 노드 생성
          const folderPath =
            parentNode === root
              ? `root/${folderName}`
              : `${parentNode.path}/${folderName}`;

          if (!folderMap.has(folderPath)) {
            const folderNode: TreeNode = {
              name: folderName,
              path: folderPath,
              depth: depth,
              isFolder: true,
              children: [],
              doc: doc, // .option 문서 참조 저장
            };
            folderMap.set(folderPath, folderNode);
            parentNode.children.push(folderNode);
          }
        }
      });

      // 일반 문서 추가 (.option이 아닌 경우)
      docsAtDepth.forEach((doc) => {
        if (doc.name === ".option") return; // 폴더 마커는 위에서 처리함

        // 상위 폴더 찾기
        let parentNode: TreeNode | undefined;
        if (doc.dir === "root") {
          parentNode = root;
        } else {
          // doc.dir과 일치하는 이름의 폴더 찾기 (depth - 1인 폴더의 자식 중)
          folderMap.forEach((node) => {
            if (
              node.name === doc.dir &&
              node.depth === depth - 1 &&
              node.isFolder
            ) {
              parentNode = node;
            }
          });
          // 부모를 찾지 못한 경우, 같은 depth-1에서 폴더 검색
          if (!parentNode) {
            folderMap.forEach((node) => {
              const childFolder = node.children.find(
                (c) =>
                  c.name === doc.dir && c.isFolder && c.depth === depth - 1,
              );
              if (childFolder) {
                parentNode = childFolder as TreeNode;
              }
            });
          }
          // 여전히 찾지 못한 경우 root에 추가
          if (!parentNode) parentNode = root;
        }

        const docPath =
          parentNode === root
            ? `root/${doc.name}`
            : `${parentNode.path}/${doc.name}`;

        parentNode.children.push({
          name: doc.name,
          path: docPath,
          depth: doc.depth,
          isFolder: false,
          children: [],
          doc: doc,
        });
      });
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
                addChannelLog(
                  `📂 문서 목록 로드: ${data.documents?.length || 0}개`,
                );
                break;
              case "docCreated":
                addLog(`문서 생성됨: ${data.docName || data.document?.name}`);
                // .option 파일이면 폴더 생성 (dir이 폴더명)
                const isFolder = data.docName === ".option";
                addChannelLog(
                  `${isFolder ? `📁 폴더 생성됨: ${data.dir}` : `📄 문서 생성됨: ${data.docName || data.document?.name}`}`,
                );
                if (!isFolder) {
                  showToast(
                    `✅ "${data.docName || data.document?.name}" 생성됨`,
                    3000,
                  );
                } else {
                  // root 폴더(.option depth=0, dir="root")는 토스트 스킵
                  if (!(data.depth === 0 && data.dir === "root")) {
                    showToast(`✅ 폴더 "${data.dir}" 생성됨`, 3000);
                  }
                }
                // 문서 목록에 추가 (서버 응답 형식에 맞게 처리)
                if (data.docId) {
                  const newDoc: Document = {
                    docId: data.docId,
                    channelId: data.channelId,
                    name: data.docName,
                    dir: data.dir,
                    depth: data.depth,
                    createdAt: new Date().toISOString(),
                  };
                  setDocuments((prev) => [...prev, newDoc]);

                  // 해당 폴더를 열린 상태로 만들기 (추가한 사용자의 UI에서만)
                  // 폴더 생성 시: 새 폴더의 부모 폴더를 열기
                  // 문서 생성 시: 문서가 속한 폴더를 열기
                  if (isFolder) {
                    // 폴더 생성 시: 부모 폴더 열기 (depth-1의 폴더 또는 root)
                    if (data.depth === 1) {
                      // depth 1인 폴더는 root 아래에 있음 - root는 이미 열려있음
                    } else if (data.depth > 1) {
                      // depth > 1인 경우 상위 폴더를 찾아서 열기
                      // 현재 구조에서는 상위 폴더 경로를 정확히 알기 어려움
                    }
                  } else {
                    // 문서 생성 시: 문서가 속한 폴더 열기
                    if (data.dir !== "root") {
                      // root가 아닌 폴더에 문서 추가 시 해당 폴더 찾아서 열기
                      setExpandedFolders((prev) => {
                        const newSet = new Set(prev);
                        // 해당 폴더명(data.dir)을 가진 폴더 경로 찾기
                        // documents에서 .option 파일을 찾아 경로 구성
                        // 일단 현재 depth에서 dir명을 가진 폴더를 찾아야 함
                        // 단순히 `root/${data.dir}` 경로를 추가 (단층 구조에서)
                        // depth에 따른 경로 계산이 필요하지만 일단 기본 처리
                        if (data.depth === 1) {
                          newSet.add(`root/${data.dir}`);
                        }
                        return newSet;
                      });
                    }
                  }
                } else if (data.document) {
                  setDocuments((prev) => [...prev, data.document]);
                }
                break;
              case "docDeleted":
                addLog(`문서 삭제됨: docId=${data.docId}`);
                addChannelLog(`🗑️ 문서 삭제됨: ${data.docName || data.docId}`);
                showToast(`🗑️ 문서가 삭제되었습니다.`, 3000);
                // 문서 목록에서 제거
                setDocuments((prev) =>
                  prev.filter((d) => d.docId !== data.docId),
                );
                break;

              // === 채널 입장/퇴장 이벤트 ===
              case "channelEntered":
                addLog(`채널 입장 완료: ${data.channelName}`);
                addChannelLog(`✅ 채널 '${data.channelName}' 입장 완료`);
                setIsChannelConnected(true);
                setOnlineUsers(data.onlineUsers || []);
                break;

              case "channelLeft":
                addLog(`채널 퇴장: ${data.channelId}`);
                addChannelLog(`👋 채널에서 퇴장했습니다.`);
                setIsChannelConnected(false);
                setOnlineUsers([]);
                break;

              // === 브로드캐스트 이벤트: 유저 입장/퇴장 ===
              case "userEntered":
                addChannelLog(`👤 ${data.email} 님이 입장했습니다.`);
                setOnlineUsers((prev) => {
                  if (prev.some((u) => u.id === data.userId)) return prev;
                  return [...prev, { id: data.userId, email: data.email }];
                });
                break;

              case "userLeft":
                addChannelLog(`👋 ${data.email} 님이 퇴장했습니다.`);
                setOnlineUsers((prev) =>
                  prev.filter((u) => u.id !== data.userId),
                );
                break;

              // === 브로드캐스트 이벤트: 문서 열람 상태 ===
              case "userEnteredDoc":
                addChannelLog(`📖 ${data.email} 님이 문서를 열람 중입니다.`);
                break;

              case "userLeftDoc":
                addChannelLog(
                  `📕 ${data.email} 님이 문서 열람을 종료했습니다.`,
                );
                break;

              case "userDocStatusChanged":
                if (data.status === "viewing") {
                  addChannelLog(`📖 ${data.email} → ${data.docName}`);
                } else {
                  addChannelLog(`📕 ${data.email} 님이 문서 열람 종료`);
                }
                setOnlineUsers((prev) =>
                  prev.map((u) =>
                    u.id === data.userId ? { ...u, currentDoc: data.docId } : u,
                  ),
                );
                break;

              // === 브로드캐스트 이벤트: 문서 목록 변경 ===
              case "docListChanged":
                addChannelLog(
                  `📋 문서 목록 변경: ${data.action} - ${data.docName}`,
                );
                // 문서 목록 새로고침 요청
                if (ws.readyState === WebSocket.OPEN && data.channelId) {
                  ws.send(
                    JSON.stringify({
                      event: "listDoc",
                      data: { time: Date.now(), channelId: data.channelId },
                    }),
                  );
                }
                break;

              // === 브로드캐스트 이벤트: 문서 수정 (이름/경로 변경) ===
              case "docUpdated":
                addChannelLog(
                  `📝 문서 수정됨: ${data.oldName} → ${data.newName}`,
                );
                // 문서 목록 갱신
                setDocuments((prev) =>
                  prev.map((d) =>
                    d.docId === data.docId
                      ? {
                          ...d,
                          name: data.newName,
                          dir: data.newDir,
                          depth: data.newDepth,
                        }
                      : d,
                  ),
                );
                break;

              case "docInfoChanged":
                addChannelLog(`📝 문서 정보 변경: ${data.newName}`);
                setDocuments((prev) =>
                  prev.map((d) =>
                    d.docId === data.docId
                      ? {
                          ...d,
                          name: data.newName,
                          dir: data.newDir,
                          depth: data.newDepth,
                        }
                      : d,
                  ),
                );
                break;

              // === 채널 유저 목록 ===
              case "channelUsers":
                addChannelLog(`👥 온라인 유저: ${data.users?.length || 0}명`);
                setOnlineUsers(data.users || []);
                break;

              case "docUsers":
                addChannelLog(
                  `📖 문서 열람 유저: ${data.users?.length || 0}명`,
                );
                break;

              // === 문서 열람 입장/퇴장 ===
              case "docEntered":
                addChannelLog(`📄 문서 '${data.docName}' 열람 시작`);
                setIsDocLoading(false);
                // 콘텐츠 설정 (읽기 전용)
                if (data.content !== undefined) {
                  setDocContent(data.content);
                } else if (data.chars && Array.isArray(data.chars)) {
                  // chars 배열이 있으면 문자열로 변환
                  interface CharData {
                    char: string;
                  }
                  const content = data.chars
                    .map((c: CharData) => c.char)
                    .join("");
                  setDocContent(content);
                }
                if (data.snapshotVersion) {
                  setLocalVersion(data.snapshotVersion);
                }
                if (data.viewingUsers) {
                  setDocViewers(data.viewingUsers);
                }
                if (data.status !== undefined) {
                  setDocStatus(data.status);
                }
                // 현재 문서 정보 업데이트
                setCurrentDoc((prev) => {
                  const updated = prev
                    ? {
                        ...prev,
                        status: data.status ?? prev.status,
                      }
                    : null;
                  // ref도 업데이트
                  currentDocRef.current = updated;
                  return updated;
                });
                break;

              case "docLeft":
                addChannelLog(`📄 문서 열람 종료`);
                break;

              // === 브로드캐스트 이벤트: 문서 상태 변경 ===
              case "docStatusChanged":
                addChannelLog(
                  `🔒 문서 상태 변경: ${data.statusText || data.status}`,
                );
                if (data.docId === currentDoc?.docId) {
                  setDocStatus(data.status);
                  if (data.message) {
                    showToast(data.message, 3000);
                  }
                }
                // 문서 목록에서도 상태 업데이트
                setDocuments((prev) =>
                  prev.map((d) =>
                    d.docId === data.docId ? { ...d, status: data.status } : d,
                  ),
                );
                break;

              // === 브로드캐스트 이벤트: 문서 동기화 완료 ===
              case "docSynced":
                addChannelLog(`🔄 문서 동기화 시작: ${data.docId}`);
                break;

              case "docSyncCompleted":
                addChannelLog(`✅ 문서 동기화 완료`);
                if (data.docId === currentDoc?.docId) {
                  if (data.snapshotVersion) {
                    setLocalVersion(data.snapshotVersion);
                  }
                  setDocStatus(DOC_STATUS.NORMAL);
                }
                showToast("📥 문서가 동기화되었습니다.", 2000);
                break;

              // === 브로드캐스트 이벤트: 스냅샷 생성 완료 ===
              case "docSnapshotCreated":
                addChannelLog(`📸 스냅샷 생성 시작: ${data.docId}`);
                break;

              case "docSnapshotCompleted":
                addChannelLog(`✅ 스냅샷 생성 완료`);
                if (data.docId === currentDoc?.docId) {
                  if (data.snapshotVersion) {
                    setLocalVersion(data.snapshotVersion);
                  }
                  setDocStatus(DOC_STATUS.NORMAL);
                  // 스냅샷 후 콘텐츠가 변경되었을 수 있으므로 업데이트
                  if (data.content !== undefined) {
                    setDocContent(data.content);
                  }
                }
                showToast("📸 스냅샷이 생성되었습니다.", 2000);
                break;

              // === 문서 상태 조회 응답 ===
              case "docStatus":
                addChannelLog(`📊 문서 상태: ${data.statusText}`);
                if (data.docId === currentDoc?.docId) {
                  setDocStatus(data.status);
                  if (data.snapshotVersion) {
                    setLocalVersion(data.snapshotVersion);
                  }
                }
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
    addChannelLog,
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

  // 채널 입장 (문서 목록 조회 + 채널 연결)
  const enterChannel = (channel: Channel) => {
    setCurrentChannel(channel);
    setDocuments([]);
    setExpandedFolders(new Set(["root"]));
    setChannelLogs([]);
    setOnlineUsers([]);
    setIsChannelConnected(false);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // 채널 실시간 연결 요청
      wsRef.current.send(
        JSON.stringify({
          event: "enterChannel",
          data: {
            time: Date.now(),
            channelId: channel.channelId,
          },
        }),
      );
      addLog(`채널 입장 요청: ${channel.channelName}`);
      addChannelLog(`🔗 채널 '${channel.channelName}' 연결 중...`);

      // 문서 목록 요청
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
    // 문서가 열려있으면 먼저 닫기
    if (currentDoc) {
      closeDocument();
    }

    // 서버에 채널 퇴장 알림
    if (wsRef.current?.readyState === WebSocket.OPEN && currentChannel) {
      wsRef.current.send(
        JSON.stringify({
          event: "leaveChannel",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
          },
        }),
      );
      addLog(`채널 퇴장 요청: ${currentChannel.channelName}`);
    }

    setCurrentChannel(null);
    setDocuments([]);
    setExpandedFolders(new Set(["root"]));
    setContextMenu(null);
    setCreateModal(null);
    setRenameModal(null);
    setOnlineUsers([]);
    setIsChannelConnected(false);
    setChannelLogs([]);
    setDragItem(null);
    setDropTarget(null);
    // 문서 관련 상태 초기화
    setCurrentDoc(null);
    currentDocRef.current = null;
    setDocContent("");
    setDocStatus(DOC_STATUS.NORMAL);
    setDocViewers([]);
    setLocalVersion("1.0.0");
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

  // 우클릭 컨텍스트 메뉴 (폴더/문서 구분)
  const handleContextMenu = (
    e: React.MouseEvent,
    targetPath: string,
    targetDepth: number,
    isFolder: boolean = true,
    doc?: Document,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      targetPath,
      targetDepth,
      isFolder,
      doc,
    });
  };

  // 컨텍스트 메뉴 닫기
  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // 생성 모달 열기
  // dir은 전체 경로(parentDir)로 사용, depth는 UI 표시용
  const openCreateModal = (type: "folder" | "document") => {
    if (!contextMenu) return;
    setCreateModal({
      type,
      dir: contextMenu.targetPath, // 전체 경로 (parentDir로 서버에 전송)
      depth: contextMenu.targetDepth, // 부모의 depth (UI 표시용, 서버가 실제 값 계산)
    });
    setNewItemName("");
    setContextMenu(null);
  };

  // 이름 변경 모달 열기
  const openRenameModal = () => {
    if (!contextMenu) return;
    const pathParts = contextMenu.targetPath.split("/");
    const oldName = pathParts[pathParts.length - 1];

    setRenameModal({
      type: contextMenu.isFolder ? "folder" : "document",
      oldName,
      oldPath: contextMenu.targetPath,
      doc: contextMenu.doc,
    });
    setNewName(oldName);
    setContextMenu(null);
  };

  // 이름 변경 실행
  const executeRename = () => {
    if (!renameModal || !currentChannel || !newName.trim()) return;

    if (renameModal.type === "document" && renameModal.doc) {
      // 문서 이름 변경
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "updateDoc",
            data: {
              time: Date.now(),
              channelId: currentChannel.channelId,
              docId: renameModal.doc.docId,
              newName: newName.trim(),
            },
          }),
        );
        addLog(`문서 이름 변경 요청: ${renameModal.oldName} → ${newName}`);
        addChannelLog(`📝 이름 변경: ${renameModal.oldName} → ${newName}`);
      }
    } else if (renameModal.type === "folder" && renameModal.doc) {
      // 폴더 이름 변경 - .option 파일의 dir(=폴더명)을 변경
      // 서버가 하위 항목들의 dir도 업데이트
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "updateDoc",
            data: {
              time: Date.now(),
              channelId: currentChannel.channelId,
              docId: renameModal.doc.docId,
              newDir: newName.trim(), // 새 폴더명이 newDir로 전송
            },
          }),
        );
      }

      addLog(`폴더 이름 변경 요청: ${renameModal.oldName} → ${newName}`);
      addChannelLog(`📁 폴더 이름 변경: ${renameModal.oldName} → ${newName}`);
    }

    setRenameModal(null);
    setNewName("");
  };

  // 드래그 시작
  const handleDragStart = (
    e: React.DragEvent,
    type: "folder" | "document",
    path: string,
    doc?: Document,
  ) => {
    e.stopPropagation();
    setDragItem({ type, path, doc });
    e.dataTransfer.effectAllowed = "move";
  };

  // 드래그 종료
  const handleDragEnd = () => {
    setDragItem(null);
    setDropTarget(null);
  };

  // 드래그 오버 (드롭 대상 위에 있을 때)
  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragItem && dragItem.path !== targetPath) {
      setDropTarget(targetPath);
      e.dataTransfer.dropEffect = "move";
    }
  };

  // 드래그 리브 (드롭 대상을 벗어났을 때)
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
  };

  // 드롭 실행
  const handleDrop = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (!dragItem || !currentChannel) {
      setDragItem(null);
      setDropTarget(null);
      return;
    }

    // 자기 자신에게 드롭하거나 자신의 하위 폴더에 드롭하면 무시
    if (
      dragItem.path === targetPath ||
      targetPath.startsWith(`${dragItem.path}/`)
    ) {
      setDragItem(null);
      setDropTarget(null);
      return;
    }

    const itemName = dragItem.path.split("/").pop() || "";

    if (dragItem.type === "document" && dragItem.doc) {
      // 문서 이동 - newDir, newDepth 직접 전송
      // targetPath 예: "root" → newDir: "root", newDepth: 1
      // targetPath 예: "root/pathA" → newDir: "pathA", newDepth: 2
      const pathParts = targetPath.split("/").filter((p) => p.length > 0);
      // root로 이동 시 dir="root", depth=1
      // 폴더로 이동 시 dir=폴더명, depth=pathParts.length (root=1, root/A=2, root/A/B=3)
      const newDir = pathParts[pathParts.length - 1] || "root";
      const newDepth = pathParts.length; // root→1, root/A→2, root/A/B→3

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "updateDoc",
            data: {
              time: Date.now(),
              channelId: currentChannel.channelId,
              docId: dragItem.doc.docId,
              newDir: newDir,
              newDepth: newDepth,
            },
          }),
        );
        addLog(`문서 이동: ${dragItem.path} → ${targetPath}/${itemName}`);
        addChannelLog(`📄 문서 이동: ${itemName} → ${targetPath}`);
      }
    } else if (dragItem.type === "folder" && dragItem.doc) {
      // 폴더 이동 - .option 파일의 dir과 depth를 변경
      // 서버가 하위 항목들의 depth도 재귀적으로 업데이트
      const folderName = dragItem.doc.dir; // .option 파일의 dir이 폴더명
      // targetPath 예: "root" → newDir: 폴더명(유지), newDepth: 1 (root 아래에 폴더)
      // targetPath 예: "root/pathA" → newDir: 폴더명(유지), newDepth: 2 (pathA 아래에 폴더)
      const pathParts = targetPath.split("/").filter((p) => p.length > 0);
      const newDepth = pathParts.length; // 대상 폴더의 하위이므로 pathParts.length

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: "updateDoc",
            data: {
              time: Date.now(),
              channelId: currentChannel.channelId,
              docId: dragItem.doc.docId,
              newDir: folderName, // 폴더명은 유지 (폴더의 dir은 자신의 이름)
              newDepth: newDepth,
            },
          }),
        );
      }

      addLog(`폴더 이동: ${dragItem.path} → ${targetPath}/${folderName}`);
      addChannelLog(`📁 폴더 이동: ${folderName} → ${targetPath}`);
    }

    setDragItem(null);
    setDropTarget(null);
  };

  // 폴더 생성
  const createFolder = () => {
    if (!createModal || !currentChannel || !newItemName.trim()) return;

    // 폴더 생성: {docName: ".option", dir: "폴더명", depth: n}
    // createModal.depth는 부모의 depth이므로 +1
    const folderDepth = createModal.depth + 1;
    const folderName = newItemName.trim();

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "createDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docName: ".option", // 폴더 마커
            dir: folderName, // 폴더명이 dir에 들어감
            depth: folderDepth,
          },
        }),
      );
      addLog(`폴더 생성 요청: ${folderName} (depth: ${folderDepth})`);

      // 부모 폴더를 열린 상태로 만들기
      setExpandedFolders((prev) => {
        const newSet = new Set(prev);
        newSet.add(createModal.dir); // 부모 폴더 경로 추가
        return newSet;
      });
    }

    setCreateModal(null);
    setNewItemName("");
  };

  // 문서 생성
  const createDocument = () => {
    if (!createModal || !currentChannel || !newItemName.trim()) return;

    // 문서 생성: {docName: "파일명", dir: "상위폴더명", depth: n}
    // createModal.depth는 부모의 depth이므로 +1 (단, root는 depth -1이므로 특별 처리)
    const docDepth = createModal.depth + 1;
    // dir은 상위 폴더명 (root의 경우 "root")
    const parentDir = createModal.dir.split("/").pop() || "root";

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "createDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docName: newItemName.trim(),
            dir: parentDir,
            depth: docDepth,
          },
        }),
      );
      addLog(`문서 생성 요청: ${parentDir}/${newItemName.trim()}`);

      // 부모 폴더를 열린 상태로 만들기
      setExpandedFolders((prev) => {
        const newSet = new Set(prev);
        newSet.add(createModal.dir); // 부모 폴더 경로 추가
        return newSet;
      });
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

  // 폴더 삭제 (해당 폴더의 .option 파일과 하위 모든 문서 삭제)
  const deleteFolder = (folderPath: string) => {
    if (!currentChannel) return;

    // 폴더명 추출 (경로의 마지막 부분)
    const folderName = folderPath.split("/").pop() || "";

    // 해당 폴더의 .option 파일과 해당 폴더를 dir로 가진 모든 문서 찾기
    const docsToDelete = documents.filter(
      (doc) =>
        // .option 파일이고 dir이 폴더명인 경우 (폴더 자체)
        (doc.name === ".option" && doc.dir === folderName) ||
        // dir이 폴더명인 일반 문서
        doc.dir === folderName,
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

    addLog(`폴더 삭제 요청: ${folderName} (${docsToDelete.length}개 문서)`);
  };

  // 문서 열람 시작 (읽기 전용)
  const openDocument = (doc: Document) => {
    if (!currentChannel) return;

    setIsDocLoading(true);
    setCurrentDoc(doc);
    currentDocRef.current = doc;
    setDocContent("");
    setDocStatus(DOC_STATUS.NORMAL);
    setLocalVersion("1.0.0");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "enterDoc",
          data: {
            time: Date.now(),
            channelId: currentChannel.channelId,
            docId: doc.docId,
          },
        }),
      );
      addLog(`문서 열람 시작: ${doc.name}`);
      addChannelLog(`📖 문서 열람 시작: ${doc.name}`);
    }
  };

  // 문서 열람 종료
  const closeDocument = () => {
    if (!currentDoc) return;

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: "leaveDoc",
          data: {
            time: Date.now(),
            docId: currentDoc.docId,
          },
        }),
      );
      addLog(`문서 열람 종료: ${currentDoc.name}`);
      addChannelLog(`📕 문서 열람 종료: ${currentDoc.name}`);
    }

    setCurrentDoc(null);
    currentDocRef.current = null;
    setDocContent("");
    setDocStatus(DOC_STATUS.NORMAL);
    setDocViewers([]);
    setLocalVersion("1.0.0");
  };

  // 트리 노드 렌더링 (드래그앤드랍 지원)
  const renderTreeNode = (
    node: TreeNode,
    level: number = 0,
  ): React.ReactNode => {
    const isExpanded = expandedFolders.has(node.path);
    const paddingLeft = level * 16;
    const isDragging = dragItem?.path === node.path;
    const isDropTarget = dropTarget === node.path;

    if (node.isFolder) {
      return (
        <div key={node.path}>
          <div
            className={`flex items-center py-1 px-2 cursor-pointer select-none transition-colors ${
              isDragging
                ? "opacity-50 bg-gray-600"
                : isDropTarget
                  ? "bg-blue-600/30 border border-blue-500 border-dashed"
                  : "hover:bg-gray-700"
            }`}
            style={{ paddingLeft: `${paddingLeft + 8}px` }}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) =>
              handleContextMenu(e, node.path, node.depth, true, node.doc)
            }
            draggable={node.path !== "root"}
            onDragStart={(e) =>
              handleDragStart(e, "folder", node.path, node.doc)
            }
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, node.path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, node.path)}
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
        className={`flex items-center py-1 px-2 cursor-pointer select-none group transition-colors ${
          isDragging
            ? "opacity-50 bg-gray-600"
            : currentDoc?.docId === node.doc?.docId
              ? "bg-blue-600/30 border-l-2 border-blue-500"
              : "hover:bg-gray-700"
        }`}
        style={{ paddingLeft: `${paddingLeft + 20}px` }}
        onClick={() => node.doc && openDocument(node.doc)}
        onContextMenu={(e) =>
          handleContextMenu(e, node.path, node.depth, false, node.doc)
        }
        draggable
        onDragStart={(e) => handleDragStart(e, "document", node.path, node.doc)}
        onDragEnd={handleDragEnd}
      >
        <span className="mr-1">
          {node.doc?.status === DOC_STATUS.LOCKED ? "🔒" : "📄"}
        </span>
        <span className="text-sm text-gray-300 truncate flex-1">
          {node.name}
        </span>
        {currentDoc?.docId === node.doc?.docId && (
          <span className="text-xs text-blue-400">●</span>
        )}
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
          className="fixed bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.isFolder ? (
            <>
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
                    onClick={openRenameModal}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
                  >
                    ✏️ 이름 변경
                  </button>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `"${contextMenu.targetPath.split("/").pop()}" 폴더를 삭제하시겠습니까?\n(하위 모든 내용이 삭제됩니다)`,
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
            </>
          ) : (
            <>
              <button
                onClick={openRenameModal}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-700 flex items-center gap-2"
              >
                ✏️ 이름 변경
              </button>
              <div className="border-t border-gray-600 my-1" />
              <button
                onClick={() => {
                  if (
                    contextMenu.doc &&
                    confirm(
                      `"${contextMenu.doc.name}" 문서를 삭제하시겠습니까?`,
                    )
                  ) {
                    deleteDocument(contextMenu.doc.docId);
                  }
                  setContextMenu(null);
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-red-600 text-red-400 hover:text-white flex items-center gap-2"
              >
                🗑️ 문서 삭제
              </button>
            </>
          )}
        </div>
      )}

      {/* 이름 변경 모달 */}
      {renameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className="bg-gray-800 rounded-lg p-6 w-96 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-4">
              {renameModal.type === "folder"
                ? "📁 폴더 이름 변경"
                : "📄 문서 이름 변경"}
            </h3>
            <p className="text-sm text-gray-400 mb-2">
              현재: {renameModal.oldName}
            </p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="새 이름 입력"
              className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  executeRename();
                } else if (e.key === "Escape") {
                  setRenameModal(null);
                  setNewName("");
                }
              }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setRenameModal(null);
                  setNewName("");
                }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors"
              >
                취소
              </button>
              <button
                onClick={executeRename}
                disabled={!newName.trim() || newName === renameModal.oldName}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                변경
              </button>
            </div>
          </div>
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
            <div className="p-3 border-b border-gray-700">
              <div className="flex items-center gap-2">
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
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isChannelConnected
                      ? "bg-green-500"
                      : "bg-yellow-500 animate-pulse"
                  }`}
                  title={isChannelConnected ? "채널 연결됨" : "연결 중..."}
                />
                <span className="font-semibold truncate flex-1">
                  {currentChannel.channelName}
                </span>
                <span className="text-xs text-gray-400">
                  👥 {onlineUsers.length}
                </span>
              </div>
            </div>

            {/* 문서 트리 */}
            <div
              className="flex-1 overflow-y-auto"
              onContextMenu={(e) => handleContextMenu(e, "root", 0, true)}
              onDragOver={(e) => handleDragOver(e, "root")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "root")}
            >
              {/* root 드롭 영역 표시 */}
              <div
                className={`transition-colors ${
                  dropTarget === "root" ? "bg-blue-600/20" : ""
                }`}
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

            {/* 채널 로그 (디버깅용) */}
            <div className="border-t border-gray-700">
              <button
                onClick={() => setShowChannelLogs(!showChannelLogs)}
                className="w-full px-3 py-2 text-left text-xs text-gray-400 hover:bg-gray-700 flex items-center justify-between"
              >
                <span>
                  📋 채널 로그{" "}
                  {channelLogs.length > 0 && `(${channelLogs.length})`}
                </span>
                <span>{showChannelLogs ? "▼" : "▶"}</span>
              </button>
              {showChannelLogs && (
                <div className="px-2 pb-2">
                  <div className="bg-black rounded p-2 h-28 overflow-y-auto font-mono text-xs">
                    {channelLogs.length === 0 ? (
                      <p className="text-gray-500">로그가 없습니다</p>
                    ) : (
                      channelLogs.map((log, index) => (
                        <p key={index} className="text-cyan-400">
                          {log}
                        </p>
                      ))
                    )}
                  </div>
                  <button
                    onClick={() => setChannelLogs([])}
                    className="mt-1 text-xs text-gray-500 hover:text-gray-300"
                  >
                    지우기
                  </button>
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
        ) : !currentDoc ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500">
              <p className="text-lg">문서를 선택하세요</p>
              <p className="text-sm mt-2">
                좌측에서 문서를 클릭하여 열람합니다
              </p>
            </div>
          </div>
        ) : (
          /* 문서 편집 영역 */
          <div className="flex-1 flex flex-col h-full">
            {/* 문서 헤더 */}
            <div className="border-b border-gray-700 bg-gray-800 px-4 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={closeDocument}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                    title="문서 닫기"
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
                  <div>
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      {docStatus === DOC_STATUS.LOCKED && (
                        <span className="text-yellow-500" title="잠금 상태">
                          🔒
                        </span>
                      )}
                      {currentDoc.name}
                    </h2>
                    <p className="text-xs text-gray-400">
                      {currentDoc.dir}/{currentDoc.name} · v{localVersion}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 열람 중인 유저 표시 */}
                  {docViewers.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <span>👥</span>
                      <span>{docViewers.length}명 열람 중</span>
                    </div>
                  )}
                  {/* 상태 표시 */}
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      docStatus === DOC_STATUS.NORMAL
                        ? "bg-green-600/30 text-green-400"
                        : docStatus === DOC_STATUS.LOCKED
                          ? "bg-yellow-600/30 text-yellow-400"
                          : "bg-red-600/30 text-red-400"
                    }`}
                  >
                    {docStatus === DOC_STATUS.NORMAL
                      ? "정상"
                      : docStatus === DOC_STATUS.LOCKED
                        ? "잠금"
                        : "삭제됨"}
                  </span>
                </div>
              </div>
            </div>

            {/* 문서 내용 표시 영역 (읽기 전용) */}
            <div className="flex-1 p-4 overflow-hidden">
              {isDocLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-gray-400 flex items-center gap-2">
                    <svg
                      className="animate-spin w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    <span>문서 로딩 중...</span>
                  </div>
                </div>
              ) : (
                <div
                  className="w-full h-full bg-gray-900 text-gray-100 p-4 rounded-lg border border-gray-700 font-mono text-sm overflow-auto whitespace-pre-wrap"
                  style={{ minHeight: "300px" }}
                >
                  {docContent || (
                    <span className="text-gray-500">문서 내용이 없습니다.</span>
                  )}
                </div>
              )}
            </div>

            {/* 상태 바 */}
            <div className="border-t border-gray-700 bg-gray-800 px-4 py-1 text-xs text-gray-400 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span>문자 수: {docContent.length.toLocaleString()}</span>
                <span>
                  줄 수: {docContent.split("\n").length.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span>버전: {localVersion}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
