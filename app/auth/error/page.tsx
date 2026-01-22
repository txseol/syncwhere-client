"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function ErrorContent() {
  const searchParams = useSearchParams();
  const message =
    searchParams.get("message") || "알 수 없는 오류가 발생했습니다";

  useEffect(() => {
    console.error("[AuthError] 에러 페이지 표시:", message);
  }, [message]);

  const handleGoHome = () => {
    console.log("[AuthError] 홈으로 이동");
    window.location.href = "/";
  };

  const handleRetryLogin = () => {
    console.log("[AuthError] 로그인 재시도");
    window.location.href = "/auth/google/login?platform=web";
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center max-w-md p-6">
        <div className="text-red-500 text-5xl mb-4">✕</div>
        <p className="text-xl mb-2">로그인 실패</p>
        <p className="text-gray-400 mt-2 mb-6">{message}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleRetryLogin}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            다시 로그인
          </button>
          <button
            onClick={handleGoHome}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
          >
            홈으로
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
