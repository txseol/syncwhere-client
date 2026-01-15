import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL!;
const REDIRECT_URI = "https://syncwhere.com/api/auth/google/callback";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const errorParam = searchParams.get("error");

  // 에러 처리
  if (errorParam) {
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent(`Google 로그인 오류: ${errorParam}`)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent("인증 코드가 없습니다")}`
    );
  }

  try {
    // 서버에서 토큰 교환
    const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        platform: "browser",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "인증 실패");
    }

    // 성공 페이지로 리다이렉트하면서 토큰을 쿠키로 설정
    const redirectResponse = NextResponse.redirect(
      new URL("/auth/success", request.url)
    );

    // HttpOnly 쿠키로 토큰 설정 (보안 강화)
    redirectResponse.cookies.set("auth_token", data.token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7일
      path: "/",
    });

    // 사용자 정보는 일반 쿠키로 설정 (클라이언트에서 읽을 수 있도록)
    redirectResponse.cookies.set("user_info", JSON.stringify(data.user), {
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return redirectResponse;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.redirect(
      `https://syncwhere.com/auth/error?message=${encodeURIComponent(errorMessage)}`
    );
  }
}
