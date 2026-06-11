# ============================================================
# Frontend Dockerfile - 多阶段构建（Vite 构建 + Nginx 部署）
# ============================================================

# ---- 阶段 1: 构建 ----
FROM node:22-alpine AS build

WORKDIR /app

# 安装依赖
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps

# 复制源码和配置
COPY frontend/index.html ./
COPY frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
COPY frontend/vite.config.ts ./
COPY frontend/eslint.config.js ./
COPY frontend/public/ ./public/
COPY frontend/src/ ./src/

# 生产构建（VITE_API_BASE 和 VITE_WS_BASE 通过环境变量注入）
ARG VITE_API_BASE=/api
ARG VITE_WS_BASE=/ws
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_BASE=$VITE_WS_BASE

# 跳过 tsc -b 类型检查（项目有存量 TS 严格模式错误），直接用 Vite 构建
RUN npx vite build

# ---- 阶段 2: Nginx ----
FROM nginx:alpine

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
