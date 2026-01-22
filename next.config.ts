import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server Actions 캐시 문제 방지
  experimental: {
    // Server Actions를 명시적으로 비활성화 (클라이언트 컴포넌트만 사용)
    serverActions: {
      bodySizeLimit: "1mb",
    },
  },
  // 상세한 로깅 활성화
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  // 런타임 설정
  serverExternalPackages: [],
};

export default nextConfig;
