# Dashboard

Binance 现货价格监控面板，支持 Telegram 与 FwAlert 电话通知。

## VPS 部署（Ubuntu/Debian root）

部署前，请将域名的 A/AAAA 记录指向 VPS，并确保 80、443 未被其他服务占用。Caddy 会自动申请并续期 HTTPS 证书。

建议在 Cloudflare 中为域名启用 Proxy（橙云），并在 SSL/TLS 中选择 **Full (strict)**。

### 普通安装

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/21Hzzzz/dashboard/master/scripts/deploy.sh) install
```

### 从旧版 Price Alert 重新部署

本项目现使用 `/opt/dashboard`、`DASHBOARD_ENCRYPTION_KEY` 和新的数据库文件名。若旧版部署中没有需要保留的数据，请先在 VPS 上停止并清理旧版，再运行上方的新安装命令：

```bash
bash /opt/price-alert/scripts/deploy.sh uninstall --purge-data
```

### Cloudflare 源站锁定安装

若域名已开启 Cloudflare Proxy，使用下列命令。脚本会仅允许 Cloudflare IPv4/IPv6 网段访问 VPS 的 80/443，并每日同步网段；源站 IP 将不能再被直接访问。

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/21Hzzzz/dashboard/master/scripts/deploy.sh) install --cloudflare-origin-lockdown
```

安装脚本会隐藏输入面板密码、安装 Docker（如需要）、生成加密及会话密钥，并将应用部署至 `/opt/dashboard`。生产环境缺少面板认证配置时，应用会拒绝启动，而不会开放面板。

### 更新

普通更新会保留 `.env`、`data/` 和 `caddy/`：

```bash
bash /opt/dashboard/scripts/deploy.sh update
```

为已有安装启用 Cloudflare 源站锁定：

```bash
bash /opt/dashboard/scripts/deploy.sh update --cloudflare-origin-lockdown
```

启用后，更新会先同步 Cloudflare IP 网段并重载 Caddy 的可信代理配置。若无法下载网段或域名未解析到 Cloudflare，更新会停止，保留上一次成功的防火墙规则。

### 更换域名

先在 Cloudflare 完成新域名的配置：

- 将新域名的 `A` 记录指向 VPS IPv4；如 VPS 使用 IPv6，同时设置 `AAAA` 记录。
- 开启 Cloudflare Proxy（橙云）。若启用了本项目的源站锁定，这是必须项。
- 在 Cloudflare 的 SSL/TLS 设置中确认模式为 **Full (strict)**。

DNS 生效后，以 root 执行：

```bash
bash /opt/dashboard/scripts/deploy.sh change-domain --domain alert.example.com
```

该命令会备份 `.env`、保留 `data/`、面板密码与 Caddy 数据，并重建服务以让 Caddy 为新域名申请 HTTPS 证书。旧域名不会继续提供面板访问。

### 卸载

卸载容器并保留数据；如曾启用源站锁定，也会清理本项目创建的防火墙规则和 systemd 同步任务：

```bash
bash /opt/dashboard/scripts/deploy.sh uninstall
```

彻底卸载并删除数据、配置和证书：

```bash
bash /opt/dashboard/scripts/deploy.sh uninstall --purge-data
```

## Cloudflare 建议

- SSL/TLS 设为 **Full (strict)**。
- 开启托管 WAF 规则，并为 `POST /api/auth/login` 设置边缘速率限制。
- 可选启用 Authenticated Origin Pulls；它需要额外配置 Caddy 的客户端证书校验。

## 本地开发

```bash
bun install
bun run dev
```

本地开发若确实需要关闭认证，显式设置 `PANEL_AUTH_DISABLED=true`。该开关在生产环境无效。

SQLite 默认保存在 `./data/dashboard.sqlite`。

## 验证

```bash
bun run typecheck
bun test
bun run build
```
