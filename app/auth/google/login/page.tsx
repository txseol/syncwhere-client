import { redirect } from "next/navigation";

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!;

// Next.js 15+에서 searchParams는 Promise로 전달됨
export default async function GoogleLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  // searchParams를 await하여 실제 값 추출
  const params = await searchParams;
  const platform = params.platform;

  // 환경변수 검증
  if (!GOOGLE_CLIENT_ID) {
    redirect(
      "/auth/error?message=" +
        encodeURIComponent("Google Client ID가 설정되지 않았습니다"),
    );
  }

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
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("access_type", "offline");
  googleAuthUrl.searchParams.set("prompt", "consent");

  redirect(googleAuthUrl.toString());
}
