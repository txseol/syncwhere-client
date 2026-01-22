// app/auth/google/login/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

function GoogleLoginContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // 이미 리다이렉트 중이면 무시
    if (isRedirecting) return;

    console.log("[GoogleLogin] 페이지 로드됨");

    // 환경변수 검증
    if (!GOOGLE_CLIENT_ID) {
      const errMsg = "Google Client ID가 설정되지 않았습니다";
      console.error("[GoogleLogin] 에러:", errMsg);
      setError(errMsg);
      return;
    }

    try {
      const platform = searchParams.get("platform") || "web";
      console.log("[GoogleLogin] platform:", platform);

      // platform에 따라 redirect_uri 설정
      let redirectUri: string;
      switch (platform) {
        case "vscode":
          redirectUri = "https://syncwhere.com/auth/vscode/callback";
          break;
        case "web":
        default:
          redirectUri = "https://syncwhere.com/auth/google/callback";
          break;
      }

      // Google OAuth 2.0 URL 생성
      const googleAuthUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
      googleAuthUrl.searchParams.set("response_type", "code");
      googleAuthUrl.searchParams.set("scope", "openid email profile");
      googleAuthUrl.searchParams.set("access_type", "offline");
      googleAuthUrl.searchParams.set("prompt", "consent");

      console.log("[GoogleLogin] Google OAuth로 리다이렉트 시작");
      setIsRedirecting(true);

      // window.location.href로 리다이렉트 (Server Action 대신)
      window.location.href = googleAuthUrl.toString();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "URL 생성 실패";
      console.error("[GoogleLogin] 에러:", errMsg);
      setError(errMsg);
    }
  }, [searchParams, isRedirecting]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <p className="text-xl mb-2">오류 발생</p>
          <p className="text-gray-400">{error}</p>
          <button
            onClick={() => (window.location.href = "/")}
            className="mt-4 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
        <p className="text-xl">Google 로그인으로 이동 중...</p>
      </div>
    </div>
  );
}

export default function GoogleLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
            <p className="text-xl">로딩 중...</p>
          </div>
        </div>
      }
    >
      <GoogleLoginContent />
    </Suspense>
  );
}
