// app/auth/vscode/page.tsx
"use client";

import { useEffect, useState } from "react";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
// VSCode용 콜백 URL (브라우저용과 다름!)
const REDIRECT_URI = "https://syncwhere.com/auth/vscode/callback";

export default function VscodeLogin() {
  const [error, setError] = useState<string | null>(null);
  const [isRedirecting, setIsRedirecting] = useState(false);

  useEffect(() => {
    // 이미 리다이렉트 중이면 무시
    if (isRedirecting) return;

    console.log("[VscodeLogin] 페이지 로드됨");

    // 환경변수 검증
    if (!GOOGLE_CLIENT_ID) {
      const errMsg = "Google Client ID가 설정되지 않았습니다";
      console.error("[VscodeLogin] 에러:", errMsg);
      setError(errMsg);
      return;
    }

    try {
      const googleAuthUrl = new URL(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
      googleAuthUrl.searchParams.set("redirect_uri", REDIRECT_URI);
      googleAuthUrl.searchParams.set("response_type", "code");
      googleAuthUrl.searchParams.set("scope", "email profile");
      googleAuthUrl.searchParams.set("access_type", "offline");

      console.log("[VscodeLogin] Google OAuth로 리다이렉트 시작");
      setIsRedirecting(true);

      window.location.href = googleAuthUrl.toString();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "URL 생성 실패";
      console.error("[VscodeLogin] 에러:", errMsg);
      setError(errMsg);
    }
  }, [isRedirecting]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-5xl mb-4">✕</div>
          <p className="text-xl mb-2">오류 발생</p>
          <p className="text-gray-400">{error}</p>
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
