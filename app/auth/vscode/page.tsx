"use client";

import { useEffect } from "react";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;
// VSCode용 콜백 URL (브라우저용과 다름!)
const REDIRECT_URI = "https://syncwhere.com/auth/vscode/callback";

export default function VscodeLogin() {
  useEffect(() => {
    const googleAuthUrl = new URL(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    googleAuthUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    googleAuthUrl.searchParams.set("response_type", "code");
    googleAuthUrl.searchParams.set("scope", "email profile");
    googleAuthUrl.searchParams.set("access_type", "offline");

    window.location.href = googleAuthUrl.toString();
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
        <p className="text-xl">Google 로그인으로 이동 중...</p>
      </div>
    </div>
  );
}
