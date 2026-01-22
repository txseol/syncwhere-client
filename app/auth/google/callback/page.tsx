"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [error, setError] = useState<string>("");
  const hasProcessed = useRef(false); // 중복 실행 방지

  useEffect(() => {
    // 이미 처리했으면 무시
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    console.log("[GoogleCallback] 콜백 페이지 로드됨");

    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      console.error("[GoogleCallback] Google 에러:", errorParam);
      setStatus("error");
      setError(`Google 로그인 오류: ${errorParam}`);
      return;
    }

    if (!code) {
      console.error("[GoogleCallback] 인증 코드 없음");
      setStatus("error");
      setError("인증 코드가 없습니다");
      return;
    }

    console.log("[GoogleCallback] 인증 코드 수신, 토큰 교환 시작");
    exchangeCodeForToken(code);
  }, [searchParams, router]);

  const exchangeCodeForToken = async (code: string) => {
    // API URL 검증
    if (!API_BASE_URL) {
      console.error("[GoogleCallback] API_BASE_URL 미설정");
      setStatus("error");
      setError("API 서버 URL이 설정되지 않았습니다");
      return;
    }

    try {
      console.log(
        "[GoogleCallback] API 요청 시작:",
        `${API_BASE_URL}/api/auth/google`,
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15초 타임아웃

      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          platform: "browser",
          redirect_uri: "https://syncwhere.com/auth/google/callback",
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log("[GoogleCallback] API 응답 상태:", response.status);

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data.error_description || data.error || "인증 실패";
        console.error("[GoogleCallback] API 에러:", errMsg);
        throw new Error(errMsg);
      }

      console.log("[GoogleCallback] 토큰 교환 성공, 사용자:", data.user?.email);

      // 토큰과 사용자 정보 저장
      try {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        console.log("[GoogleCallback] 로컬 스토리지 저장 완료");
      } catch (storageError) {
        console.error(
          "[GoogleCallback] 로컬 스토리지 저장 실패:",
          storageError,
        );
        throw new Error("인증 정보 저장에 실패했습니다");
      }

      setStatus("success");

      // 메인 페이지로 리다이렉트
      setTimeout(() => {
        console.log("[GoogleCallback] 메인 페이지로 리다이렉트");
        router.push("/");
      }, 1000);
    } catch (err) {
      setStatus("error");
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          console.error("[GoogleCallback] 요청 타임아웃");
          setError("요청 시간이 초과되었습니다. 다시 시도해주세요.");
        } else {
          console.error("[GoogleCallback] 에러:", err.message);
          setError(err.message);
        }
      } else {
        console.error("[GoogleCallback] 알 수 없는 에러:", err);
        setError("알 수 없는 오류가 발생했습니다");
      }
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-center">
        {status === "loading" && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
            <p className="text-xl">로그인 처리 중...</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="text-green-500 text-5xl mb-4">✓</div>
            <p className="text-xl">로그인 성공!</p>
            <p className="text-gray-400 mt-2">메인 페이지로 이동합니다...</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="text-red-500 text-5xl mb-4">✕</div>
            <p className="text-xl">로그인 실패</p>
            <p className="text-gray-400 mt-2">{error}</p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg transition-colors"
            >
              돌아가기
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function GoogleCallback() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
