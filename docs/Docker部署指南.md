# Docker 部署指南 — 隐墨 · 隐私协同编辑器

## 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    云服务器                           │
│  ┌──────────────────┐    ┌─────────────────────────┐ │
│  │  Nginx (frontend) │◄──►│  Express (backend)      │ │
│  │  :80              │    │  :3001 (内部)            │ │
│  │  ├─ 静态文件       │    │  ├─ REST API             │ │
│  │  ├─ /api → 代理    │    │  ├─ WebSocket (/ws)      │ │
│  │  └─ /ws  → 代理    │    │  └─ Yjs CRDT 协同        │ │
│  └──────────────────┘    └─────────────────────────┘ │
│                              │                       │
│                         ┌────▼──────┐                │
│                         │ Docker Vol │               │
│                         │ (持久化)    │               │
│                         └───────────┘               │
└─────────────────────────────────────────────────────┘
```

**关键设计决策：**

| 方面 | 开发环境 | 生产环境 (Docker) |
|------|---------|-------------------|
| 前端 API 地址 | `http://localhost:3001/api` | `/api`（nginx 反向代理） |
| WebSocket 地址 | `ws://localhost:3001/ws` | `wss://域名/ws` 或 `ws://IP/ws` |
| 跨域 (CORS) | 后端直接处理 | nginx 同源代理，无跨域问题 |

---

## 前置条件

1. **云服务器**：安装了 Docker Engine 20.10+ 和 Docker Compose v2+
2. **域名**（可选）：如需 HTTPS，需要域名 + SSL 证书

### 云服务器安装 Docker（以 Ubuntu 为例）

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | bash

# 将当前用户加入 docker 组（免 sudo）
sudo usermod -aG docker $USER

# 重新登录或执行
newgrp docker

# 验证安装
docker --version
docker compose version
```

---

## 部署步骤

### 1. 将项目上传到服务器

```bash
# 方式 A：通过 Git 克隆
git clone <your-repo-url> privacy-crdt-editor
cd privacy-crdt-editor

# 方式 B：通过 scp 上传（在本地执行）
scp -r ./privacy-crdt-editor user@your-server-ip:/home/user/
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env，生成强随机 JWT 密钥
nano .env
```

生成 JWT 密钥的命令：

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. 构建并启动

```bash
# 在项目根目录执行
docker compose up -d --build
```

首次构建约需 3-5 分钟（下载基础镜像 + npm install）。后续代码更新只需：

```bash
docker compose up -d --build
```

### 4. 验证部署

```bash
# 查看容器状态
docker compose ps

# 查看后端日志
docker compose logs backend -f

# 测试健康检查
curl http://localhost:3001/api/health
# 预期返回: {"status":"ok","message":"Privacy CRDT backend is running"}

# 测试前端
curl http://localhost/
# 预期返回 HTML 页面
```

---

## 常用运维命令

```bash
# 查看所有容器日志
docker compose logs -f

# 仅查看后端日志
docker compose logs backend -f

# 重启服务
docker compose restart

# 停止服务
docker compose down

# 停止并删除数据卷（⚠️ 会丢失持久化数据！）
docker compose down -v

# 进入后端容器调试
docker compose exec backend sh

# 查看资源占用
docker stats
```

---

## 数据持久化

后端 Y.Doc 数据存储在 Docker 命名卷 `backend_data` 中，映射到容器内 `/app/data`。

**备份数据：**

```bash
# 查看卷的实际位置
docker volume inspect privacy-crdt-editor_backend_data

# 备份卷数据
docker run --rm -v privacy-crdt-editor_backend_data:/data -v $(pwd):/backup alpine tar czf /backup/backend-data-$(date +%Y%m%d).tar.gz -C /data .
```

**恢复数据：**

```bash
docker run --rm -v privacy-crdt-editor_backend_data:/data -v $(pwd):/backup alpine tar xzf /backup/backend-data-20260101.tar.gz -C /data
```

---

## 配置 HTTPS（使用 Caddy 作为反向代理）

如果需要在生产环境启用 HTTPS，推荐在 Docker 外使用 Caddy：

### 安装 Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

### 配置 Caddyfile

```caddyfile
# /etc/caddy/Caddyfile
your-domain.com {
    reverse_proxy localhost:80
}
```

然后重载 Caddy：

```bash
sudo systemctl reload caddy
```

Caddy 会自动申请和续期 Let's Encrypt SSL 证书。

### 使用 Nginx 反向代理 HTTPS（替代方案）

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 代理
    location /ws {
        proxy_pass http://127.0.0.1:80/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 防火墙配置

确保云服务器安全组/防火墙开放以下端口：

| 端口 | 协议 | 用途 |
|------|------|------|
| 80 | TCP | HTTP（前端入口） |
| 443 | TCP | HTTPS（如配置了 SSL） |
| 3001 | TCP | ⚠️ 仅内部使用，**不建议**对外开放 |

---

## 性能优化建议

1. **JWT_SECRET**：务必修改 `.env` 中的默认值，使用 `crypto.randomBytes(64).toString('hex')` 生成
2. **内存限制**：可在 `docker-compose.yml` 中添加 `mem_limit: 512m` 限制容器内存
3. **日志轮转**：在 `/etc/docker/daemon.json` 中配置：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

---

## 故障排查

### 容器无法启动
```bash
docker compose logs  # 查看所有日志
docker compose ps -a  # 查看退出容器
```

### 前端能访问但 API 请求 502
检查 backend 容器是否正常运行：
```bash
docker compose exec backend node -e "require('http').get('http://localhost:3001/api/health',r=>{r.on('data',d=>console.log(d.toString()))})"
```

### WebSocket 连接失败
- 检查 nginx 配置中 `/ws` location 是否包含 `Upgrade` 和 `Connection` 头
- 如果使用了外部 HTTPS 代理，确保它支持 WebSocket 升级

### 端口冲突
修改 `.env` 中的 `FRONTEND_PORT`：
```bash
# .env
FRONTEND_PORT=8080
```
