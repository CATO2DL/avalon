# 最少改动的公网试玩方案（审查；尚未部署）

## 当前结论

当前每秒GET完整过滤快照，POST行动意图、独立HttpOnly会话Cookie、服务端权威状态和幂等重试，适合小规模公网隧道试玩。无需先改WebSocket/SSE。浏览器同源访问即可，避免跨域前后端。

但**现版不能只填PUBLIC_ORIGIN就直接用于HTTPS隧道**。本地内存服务器实际复现：

| 模拟请求 | 结果 |
|---|---|
| Host=avalon.example.test、Origin=https://avalon.example.test，配置相同PUBLIC_ORIGIN | 403 INVALID_HOST |
| Host重写为127.0.0.1:端口，Origin仍是外部https | 403 INVALID_ORIGIN |
| 纯本机请求 | 200 |

原因：room-server固定用http://Host作请求origin；HTTPS公网origin无法匹配。另有邀请/二维码要求lan=true、Cookie未按外部HTTPS加Secure的问题。这只是本机代理头模拟，未启用真实隧道。

## 最少代码改动（下一实施任务）

1. 严格解析配置的PUBLIC_ORIGIN为单一HTTPS origin。外部Host与其host完全匹配时采用配置的origin，不能任意相信客户端X-Forwarded-Host/Proto。保留回环访问分支和Origin/跨站拒绝，不能用放开CORS解决。
2. PUBLIC_ORIGIN配置时允许邀请链接和二维码，即使服务只绑定127.0.0.1。全部邀请与QR使用同一外部HTTPS地址。
3. 外部HTTPS会话加Secure，保留HttpOnly、SameSite=Strict、host-only Cookie。不要把座位凭证放进邀请链接；地址更换后旧域Cookie不会迁移，试玩期间不要重建临时隧道。
4. 试玩增加独立访问口令/边缘访问门禁，及建房、加入、POST操作的有界速率和容量限制。当前仅新建会话有100/分钟限制，代理后的remoteAddress会聚合，不能据此认为已有公网滥用防护。AI供应商Key仍只在电脑；试玩设置每局调用上限和房间数，避免任何访客耗尽模型额度。
5. 验证两个独立浏览器经模拟代理建房/邀请/投票/重试/重连、Host和Origin伪造被拒、Secure Cookie、未知路径不可读.env/数据库；再做一次真实手机外网验收。

这些是所需变更清单，本轮没有关闭安全校验、安装隧道、修改防火墙、购买服务或部署。

## 推荐试玩方式

小范围临时试玩可用Cloudflare Quick Tunnel，将HTTPS地址转到本机回环4180。官方说明它提供临时trycloudflare.com地址，最多200个同时进行中的请求，且不支持SSE；当前短轮询不依赖SSE。10个玩家每秒约10次请求，是否满足延迟/负载仍须实际测量，不能把200当作人数保证。

完成上述补丁后再执行的示例（**当前不要直接当成已通过的启动命令**）：

```sh
# 先按官方来源安装cloudflared；本轮未安装。
cloudflared tunnel --url http://127.0.0.1:4180
# 得到临时HTTPS地址后，另一个终端指定同一个地址；端口仍只监听回环。
PUBLIC_ORIGIN=https://实际生成的地址.trycloudflare.com npm start
```

先启动本机服务取得隧道地址，再带PUBLIC_ORIGIN重启，朋友只在配置完成后加入。保持电脑运行、终端与隧道在线；结束试玩停隧道即可撤销临时入口。公开试玩前先配置访问门禁，不把随机地址当完整访问控制。使用当前SQLite单实例即可，不引入云数据库/分布式部署。

资料（2026-10-20查阅）：[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)、[Origin参数与Host处理](https://developers.cloudflare.com/tunnel/reference/origin-parameters/)。
