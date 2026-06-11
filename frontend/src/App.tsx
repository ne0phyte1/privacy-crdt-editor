import { useState, useCallback, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "./hooks/useApi";
import LoginPage from "./LoginPage";
import Workspace from "./Workspace";

function App() {
  const { user, login, register, logout } = useAuth();
  const [splashDone, setSplashDone] = useState(false);

  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  // 启动闪屏效果（首次加载时显示品牌动画）
  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  // 如果已有用户信息（从 localStorage 恢复），直接显示工作区
  const showEditor = !!user;
  const showLogin = splashDone && !showEditor;

  return (
    <div className="app-root">
      {/* 启动闪屏 */}
      <AnimatePresence>
        {!splashDone && (
          <div className="app-splash">
            <div className="app-splash-content">
              <svg width="64" height="64" viewBox="0 0 100 100" fill="none" className="app-splash-logo">
                <defs>
                  <linearGradient id="splashGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#ec4899" />
                  </linearGradient>
                </defs>
                <rect width="100" height="100" rx="24" fill="url(#splashGrad)" />
                <text x="50" y="68" fontFamily="'Syne', serif" fontSize="52" fontWeight="700" fill="white" textAnchor="middle">隐</text>
              </svg>
              <h1 className="app-splash-title">隐墨</h1>
              <p className="app-splash-subtitle">隐私协同 · 树形编辑器</p>
              <div className="app-splash-loader">
                <div className="app-splash-bar" />
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* 主视图切换 */}
      {showLogin && <LoginPage onLogin={login} onRegister={register} />}
      {showEditor && user && (
        <Workspace
          key={user.userId}
          user={user}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

export default App;
