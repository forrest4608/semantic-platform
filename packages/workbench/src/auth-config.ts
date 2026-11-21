/**
 * 与仓库 config/auth.example.yaml 一致的占位配置。
 * M0 不发起 OIDC 跳转，也不校验本地管理员口令。
 */
export const authConfig = {
  oidc: {
    enabled: true,
    issuer: "https://idp.example.com",
    clientId: "semantic-platform",
    clientSecretEnv: "OIDC_CLIENT_SECRET",
    redirectUri: "http://localhost:5173/auth/callback",
    scopes: ["openid", "profile", "email"],
  },
  localAdmin: {
    enabled: true,
    username: "admin",
    passwordEnv: "LOCAL_ADMIN_PASSWORD",
  },
} as const;

export type SessionKind = "anonymous" | "local-placeholder" | "sso-placeholder";
