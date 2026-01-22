// app/auth/vscode/callback/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function VscodeCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [token, setToken] = useState<string>("");
  const [error, setError] = useState<string>("");
  const hasProcessed = useRef(false); // 중복 실행 방지

  useEffect(() => {
    // 이미 처리했으면 무시
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    console.log("[VscodeCallback] 콜백 페이지 로드됨");

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      console.error("[VscodeCallback] Google 에러:", errorParam);
      setStatus("error");
      setError(`Google 로그인 오류: ${errorParam}`);
      return;
    }

    if (!code) {
      console.error("[VscodeCallback] 인증 코드 없음");
      setStatus("error");
      setError("인증 코드가 없습니다");
      return;
    }

    console.log("[VscodeCallback] 인증 코드 수신, 토큰 교환 시작");
    exchangeCodeForToken(code);
  }, [searchParams]);

  const exchangeCodeForToken = async (code: string) => {
    // API URL 검증
    if (!API_BASE_URL) {
      console.error("[VscodeCallback] API_BASE_URL 미설정");
      setStatus("error");
      setError("API 서버 URL이 설정되지 않았습니다");
      return;
    }

    try {
      console.log(
        "[VscodeCallback] API 요청 시작:",
        `${API_BASE_URL}/api/auth/google`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃

      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          platform: "vscode",
          redirect_uri: "https://syncwhere.com/auth/vscode/callback",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("[VscodeCallback] API 응답 상태:", response.status);

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error_description || data.error || "인증 실패";
        console.error("[VscodeCallback] API 에러:", errMsg);
        throw new Error(errMsg);
      }

      console.log("[VscodeCallback] 토큰 교환 성공");

      setToken(data.token);
      setStatus("success");

      // 자동으로 VSCode로 리다이렉트
      console.log("[VscodeCallback] VSCode로 리다이렉트");
      window.location.href = `vscode://syncwhere.syncwhere/callback?token=${encodeURIComponent(
        data.token,
      )}`;
    } catch (err) {
      setStatus("error");
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          console.error("[VscodeCallback] 요청 타임아웃");
          setError("요청 시간이 초과되었습니다. 다시 시도해주세요.");
        } else {
          console.error("[VscodeCallback] 에러:", err.message);
          setError(err.message);
        }
      } else {
        console.error("[VscodeCallback] 알 수 없는 에러:", err);
        setError("알 수 없는 오류가 발생했습니다");
      }
    }
  };

  const openInVscode = () => {
    console.log("[VscodeCallback] 수동 VSCode 열기 클릭");
    window.location.href = `vscode://syncwhere.syncwhere/callback?token=${encodeURIComponent(
      token,
    )}`;
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center max-w-md p-6">
        {status === "loading" && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
            <p className="text-xl">로그인 처리 중...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <p className="text-xl mb-4">로그인 성공!</p>
            <p className="text-gray-400 mb-6">
              자동으로 VSCode로 이동합니다.
              <br />
              이동하지 않으면 아래 버튼을 클릭하세요.
            </p>

            <button
              onClick={openInVscode}
              className="w-full bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition-colors"
            >
              VSCode에서 열기
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-red-500 text-5xl mb-4">✕</div>
            <p className="text-xl">로그인 실패</p>
            <p className="text-gray-400 mt-2">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VscodeCallback() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
        </div>
      }
    >
      <VscodeCallbackContent />
    </Suspense>
  );
}
