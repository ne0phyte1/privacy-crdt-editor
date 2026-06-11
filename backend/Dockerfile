# ============================================================
# 阶段 1: 构建阶段（安装依赖 + TypeScript 编译）
# ============================================================
FROM node:22-alpine AS build

WORKDIR /app

# 复制 package 文件并安装全部依赖（含 devDependencies，用于编译 TS）
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps

# 复制源码和 tsconfig
COPY backend/tsconfig.json ./
COPY backend/src/ ./src/

# 编译 TypeScript -> dist/
RUN npm run build

# ============================================================
# 阶段 2: 运行阶段（仅复制生产依赖和编译产物）
# ============================================================
FROM node:22-alpine

WORKDIR /app

# 重新安装仅生产依赖（轻量 runtime）
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# 复制编译后的 JS
COPY --from=build /app/dist ./dist

# data 目录用于 Y.Doc 持久化
RUN mkdir -p /app/data

EXPOSE 3001

CMD ["node", "dist/server.js"]
