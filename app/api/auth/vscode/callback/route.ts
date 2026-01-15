import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const REDIRECT_URI = "https://syncwhere.com/api/auth/vscode/callback";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // 에러 처리
  if (errorParam) {
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent(
        `Google 로그인 오류: ${errorParam}`
      )}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent(
        "인증 코드가 없습니다"
      )}`
    );
  }

  try {
    // 서버에서 토큰 교환
    const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        platform: "vscode",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "인증 실패");
    }

    // VSCode로 토큰 전달
    return NextResponse.redirect(
      `vscode://syncwhere.syncwhere/callback?token=${encodeURIComponent(
        data.token
      )}`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent(
        errorMessage
      )}`
    );
  }
}
