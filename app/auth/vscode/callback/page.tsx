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

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setStatus("error");
      setError(`Google 로그인 오류: ${errorParam}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setError("인증 코드가 없습니다");
      return;
    }

    exchangeCodeForToken(code);
  }, [searchParams]);

  const exchangeCodeForToken = async (code: string) => {
    // API URL 검증
    if (!API_BASE_URL) {
      setStatus("error");
      setError("API 서버 URL이 설정되지 않았습니다");
      return;
    }

    try {
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error_description || data.error || "인증 실패");
      }

      setToken(data.token);
      setStatus("success");

      // 자동으로 VSCode로 리다이렉트
      window.location.href = `vscode://syncwhere.syncwhere/callback?token=${encodeURIComponent(
        data.token,
      )}`;
    } catch (err) {
      setStatus("error");
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          setError("요청 시간이 초과되었습니다. 다시 시도해주세요.");
        } else {
          setError(err.message);
        }
      } else {
        setError("알 수 없는 오류가 발생했습니다");
      }
    }
  };

  const openInVscode = () => {
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
