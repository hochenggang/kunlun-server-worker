# Kunlun Server Worker

Kunlun 是一个轻量级（客户端内存占用 < 1MB）、高效（仅一个 .c 文件）的服务器监控系统，帮助用户实时监控服务器的性能指标，并通过直观的 Web 界面展示数据。系统由 **Kunlun Server**（后端）和 **Kunlun Client**（客户端）组成，支持跨平台部署，适用于各种 Linux 环境。本仓库是基于 `Cloudflare Worker` + `D1`的 Kunlun Server 实现，免费额度已足够轻量监控。前端由[kunlun-frontend](https://github.com/hochenggang/kunlun-frontend)实现。

---

2026.03.21 抱歉，由于破坏性更新，早期部署的 Kunlun Server Worker，需要手动到 worker 控制台-> 部署页面内更新 kunlun.worker.js 第 166 行的前端地址为 `https://raw.githubusercontent.com/hochenggang/kunlun-frontend/bba530424fd6d13fbfd560df3453c0df9321088a/dist/index.html`，否则会持续 loading


## 快速开始

### 1. 部署 Worker 版 Kunlun Server

#### 1.1 创建 Cloudflare D1 数据库和 KV 缓存
进入 Cloudflare 控制台 -> 存储和数据库 -> D1 SQL 数据库 -> 点击 创建 按钮 ->
自动跳转到 创建 D1 数据库 页面 -> 输入数据库名称为 kunlunD1  -> 点击 创建 按钮
数据库已就绪。

进入 Cloudflare 控制台 -> 存储和数据库 -> KV -> 点击 创建 按钮 -> 在名称中输入 kunlunKV  -> 点击 添加 按钮 -> KV 缓存已就绪。


#### 1.2 创建 Cloudflare Worker

##### 部署代码
进入 Cloudflare 控制台 -> Compute -> Workers 和 Pages -> 点击 `创建` 按钮 -> `创建 Worker` -> 自己起个名字 -> 点击 `部署` 按钮（稍等几秒） -> 自动跳转到成功页面 -> 点击右上角 `编辑代码` 按钮 -> [打开这个链接 ](https://github.com/hochenggang/kunlun-server-worker/blob/main/kunlun.worker.js)复制这里的代码替换 Worker 编辑页面的 worker.js 的内容 -> 点击 `部署` 按钮

##### 绑定数据库和缓存
点击左上角的 `返回` 按钮 -> 回到 Worker 页面 -> 进入顶栏 `设置` -> `绑定`
1. 点击 `添加` 按钮 -> 选择 `D1 数据库` -> `变量名称` 写 `DB`  然后 `D1 数据库` 选择上一步创建的 kunlunD1 -> 点击 `部署` 
2. 点击 `添加` 按钮 -> 选择 `D1 数据库` -> `变量名称` 写 `KV`  然后 `KV 命名空间` 选择上一步创建的 kunlunKV -> 点击 `部署`

至此服务端部署已完成。


初次安装请访问一次  `https://xxxx.workers.dev/init` 初始化数据库

注意：前端的代码会在首次访问时从 Github 拉取到 KV[index.html]，如果未来需要更新前端代码，请手动到 KV对 里面删除[index.html]键。之后再次访问时，将自动拉取最新的前端代码。

#### 1.3 设置环境变量 (重要)

使用 Admin API 管理客户端，需要设置管理员令牌：

点击左上角的 `返回` 按钮 -> 回到 Worker 页面 -> 进入顶栏 `设置` -> `环境变量`

点击 `添加变量` 按钮 ->
- `变量名称` 填写 `ADMIN_TOKEN`
- `值` 填写你想要的密码（默认密码是 `Admin123`）

点击 `部署` 按钮使变量生效。

> 注意：如果你不设置此变量，系统将使用默认密码 `Admin123`。

#### 1.4 尝试访问 Worker 地址

在浏览器中访问 `https://xxxx.workers.dev/`，即可查看服务器监控仪表盘，你也可以在 Worker 设置页面绑定你自己的域名。

默认应该没有数据显示，你还需要到你的某台服务器安装下面的客户端，填写对应的上报地址后才会有数据显示。


#### 1.5 移除某个 Client

在 D1 控制台中运行以下 SQL 语句（需替换 ? 为具体 client_id）删除某个 Client
```SQL
DELETE FROM status_latest WHERE client_id = ?;
DELETE FROM status_seconds WHERE client_id = ?;
DELETE FROM status_minutes WHERE client_id = ?;
DELETE FROM status_hours WHERE client_id = ?;
DELETE FROM client WHERE id = ?;
```

#### 1.6 使用 Admin API 管理客户端

获取所有客户端列表：
```bash
curl -X GET "https://xxxx.workers.dev/admin/client" \
  -H "Authorization: Bearer Admin123"
```

更新客户端状态（如批准客户端）：
```bash
curl -X PUT "https://xxxx.workers.dev/admin/client/1" \
  -H "Authorization: Bearer Admin123" \
  -H "Content-Type: application/json" \
  -d '{"status": 1}'
```

删除客户端及所有关联数据：
```bash
curl -X DELETE "https://xxxx.workers.dev/admin/client/1" \
  -H "Authorization: Bearer Admin123"
```

> 注意：客户端初始状态为 0（未批准），此时客户端上报的数据会被拒绝。只有将状态更新为 1 后，客户端才能正常上报数据。

---

### 2. 安装 Kunlun Client


#### 使用安装脚本

在需要监控的服务器上运行以下命令：

```bash
curl -L https://github.com/hochenggang/kunlun/raw/refs/heads/main/kunlun-client-install.sh -o kunlun-client-install.sh
chmod +x kunlun-client-install.sh
./kunlun-client-install.sh
```


上报地址填写你的 Worker 地址（如 `https://xxx.workers.dev/status`）即可完成客户端安装，客户端将每10秒上报一次状态信息到 Worker。

如果填错了，重新运行 `./kunlun-client-install.sh` 选择卸载再重新安装。


至此你已经可以正常使用全部的功能了。

---
