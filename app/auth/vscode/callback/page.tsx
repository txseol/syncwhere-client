"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;

function VscodeCallbackContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [token, setToken] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
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
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          platform: "vscode",
          redirect_uri: "https://syncwhere.com/auth/vscode/callback",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "인증 실패");
      }

      setToken(data.token);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "알 수 없는 오류");
    }
  };

  const openInVscode = () => {
    window.location.href = `vscode://syncwhere.syncwhere/callback?token=${encodeURIComponent(
      token
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
              아래 버튼을 클릭하여 VSCode로 돌아가세요.
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
