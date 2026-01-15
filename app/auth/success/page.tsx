"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AuthSuccess() {
  const router = useRouter();

  useEffect(() => {
    // 쿠키에서 사용자 정보 읽어서 localStorage에 저장 (기존 코드 호환성)
    const userCookie = document.cookie
      .split("; ")
      .find((row) => row.startsWith("user_info="));

    if (userCookie) {
      const userInfo = decodeURIComponent(userCookie.split("=")[1]);
      localStorage.setItem("user", userInfo);
    }

    // 메인 페이지로 리다이렉트
    setTimeout(() => {
      router.push("/");
    }, 1500);
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-green-500 text-5xl mb-4">✓</div>
        <p className="text-xl">로그인 성공!</p>
        <p className="text-gray-400 mt-2">메인 페이지로 이동합니다...</p>
      </div>
    </div>
  );
}
