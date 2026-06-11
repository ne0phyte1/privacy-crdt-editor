import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LoginRequest, RegisterRequest } from "./types";
import "./LoginPage.css";

// 默认演示账号快速填充 — 密码与后端 seedDefaultUsers() 一致
const DEMO_ACCOUNTS = [
  { label: "管理员", username: "admin01", password: "password123" },
  { label: "A组组长", username: "leaderA", password: "password123" },
  { label: "A组成员", username: "memberA1", password: "password123" },
  { label: "访客", username: "guest01", password: "password123" },
];

interface LoginPageProps {
  onLogin: (credentials: LoginRequest) => Promise<{ success: boolean; message: string }>;
  onRegister: (data: RegisterRequest) => Promise<{ success: boolean; message: string }>;
}

type Mode = "login" | "register";

export default function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  // ----- 登录表单状态 -----
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // ----- 注册表单状态 -----
  // ----- 共享状态 -----
  const [mode, setMode] = useState<Mode>("login");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  // 切换登录/注册时清空消息
  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setMessage(null);
  }, []);

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setMessage({ text: "请填写用户名和密码", type: "error" });
      return;
    }
    setIsSubmitting(true);
    setMessage(null);

    const result = await onLogin({ username, password });
    setIsSubmitting(false);

    if (result.success) {
      setMessage({ text: "登录成功！正在进入编辑器…", type: "success" });
    } else {
      setMessage({ text: result.message, type: "error" });
    }
  }, [username, password, onLogin]);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setMessage({ text: "请填写用户名和密码", type: "error" });
      return;
    }
    if (password.trim().length < 6) {
      setMessage({ text: "密码长度不能少于6位", type: "error" });
      return;
    }
    setIsSubmitting(true);
    setMessage(null);

    const result = await onRegister({
      username: username.trim(),
      password: password.trim(),
    });
    setIsSubmitting(false);

    if (result.success) {
      setMessage({ text: "注册成功！正在进入编辑器…", type: "success" });
    } else {
      setMessage({ text: result.message, type: "error" });
    }
  }, [username, password, onRegister]);

  const fillDemo = useCallback((u: string, p: string) => {
    setUsername(u);
    setPassword(p);
  }, []);

  // 入场动画序列
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.15, delayChildren: 0.2 } as const,
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
    },
  };

  const titleText = "隐墨";
  const isLogin = mode === "login";

  return (
    <div className="login-page">
      {/* 装饰性背景元素 */}
      <div className="login-bg-ornaments">
        <div className="login-bg-circle login-bg-circle-1" />
        <div className="login-bg-circle login-bg-circle-2" />
        <div className="login-bg-circle login-bg-circle-3" />
        <div className="login-grid-pattern" />
      </div>

      <motion.div
        className="login-container"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Logo / 标题区域 */}
        <motion.div className="login-header" variants={itemVariants}>
          <div className="login-logo">
            <svg width="48" height="48" viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <rect width="100" height="100" rx="24" fill="url(#logoGrad)" />
              <text x="50" y="68" fontFamily="'Syne', serif" fontSize="52" fontWeight="700" fill="white" textAnchor="middle">隐</text>
            </svg>
          </div>
          <h1 className="login-title">
            {titleText.split("").map((char, i) => (
              <motion.span
                key={i}
                className="login-title-char"
                initial={{ opacity: 0, y: 40, rotateX: -60 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
              >
                {char}
              </motion.span>
            ))}
          </h1>
          <motion.p
            className="login-subtitle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
          >
            隐私协同 · 树形编辑器
          </motion.p>
        </motion.div>

        {/* 登录/注册 模式切换标签 */}
        <motion.div className="login-mode-tabs" variants={itemVariants}>
          <button
            type="button"
            className={`login-mode-tab ${isLogin ? "login-mode-tab--active" : ""}`}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`login-mode-tab ${!isLogin ? "login-mode-tab--active" : ""}`}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </motion.div>

        {/* 登录 / 注册 表单 */}
        <motion.form
          className="login-form"
          key={mode}
          variants={itemVariants}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          onSubmit={isLogin ? handleLogin : handleRegister}
        >
          <div className="login-input-group">
            {/* 用户名 */}
            <div className="login-input-wrapper">
              <label className="login-label" htmlFor="username">用户名</label>
              <input
                id="username"
                className="login-input"
                type="text"
                placeholder="输入用户名…"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
              />
              <span className="login-input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
            </div>

            {/* 密码 */}
            <div className="login-input-wrapper">
              <label className="login-label" htmlFor="password">密码</label>
              <input
                id="password"
                className="login-input"
                type="password"
                placeholder="输入密码…"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? "current-password" : "new-password"}
              />
              <span className="login-input-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
            </div>

            {/* 注册模式专属字段 */}
            <AnimatePresence>
              {!isLogin && (
                <motion.div
                  className="login-register-fields"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {/* 提示：新注册用户默认为访客，admin 可提升角色 */}
                  <div className="login-register-hint">注册后默认为访客身份，管理员可为您提升权限</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 消息提示 */}
          <AnimatePresence>
            {message && (
              <motion.div
                className={`login-message login-message--${message.type}`}
                key="login-message"
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.3 }}
              >
                <span className="login-message-dot" />
                {message.text}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 提交按钮 */}
          <motion.button
            className="login-submit"
            type="submit"
            disabled={isSubmitting}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.3, duration: 0.5 }}
          >
            {isSubmitting ? (
              <span className="login-spinner" />
            ) : isLogin ? (
              "进入编辑器"
            ) : (
              "创建账户"
            )}
          </motion.button>

          {/* 演示账号快速填充（仅登录模式） */}
          {isLogin && (
            <motion.div
              className="login-demo-toggle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5, duration: 0.5 }}
            >
              <button
                type="button"
                className="login-demo-btn"
                onClick={() => setShowDemo(!showDemo)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
                快速体验 · 演示账号
              </button>

              <AnimatePresence>
                {showDemo && (
                  <motion.div
                    className="login-demo-accounts"
                    key="demo-accounts"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {DEMO_ACCOUNTS.map((acc) => (
                      <motion.button
                        key={acc.label}
                        type="button"
                        className="login-demo-account"
                        onClick={() => fillDemo(acc.username, acc.password)}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <span className="demo-account-label">{acc.label}</span>
                        <span className="demo-account-cred">{acc.username}</span>
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </motion.form>
      </motion.div>

      {/* 底部装饰文字 */}
      <motion.div
        className="login-footer"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
      >
        <span>CRDT · Yjs · 隐私视图 · RBAC/ABAC</span>
      </motion.div>
    </div>
  );
}
