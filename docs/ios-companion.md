# WebStock iPhone 网页 App

## 适用方式

WebStock 的 iPhone 版本是可添加到主屏幕的网页 App。Windows 电脑继续保存唯一数据库并执行行情、研究和采集任务；iPhone 通过 Tailscale 私网 HTTPS 查看只读移动快照，不需要公网 IP 或额外服务器。

## 首次使用

1. 在 Windows WebStock 中打开 `设置 -> 苹果手机网页 App`。
2. 如果状态显示“未安装”，点击“安装 Tailscale”；显示“待登录”后点击“登录 Tailscale”，在官方页面完成一次登录。
3. 在 iPhone 从 App Store 安装 Tailscale，并登录同一个 Tailscale 账号。
4. 回到 Windows WebStock，点击“启用 iPhone HTTPS”。
   - 第一次启用时，如果 Tailscale 尚未允许 Serve，WebStock 会自动打开官方授权页；点允许后回到 WebStock，再点击一次启用。
5. 点击“复制 iPhone 安装地址”，把完整地址发送到自己的 iPhone。
6. 在 iPhone Safari 打开该地址。首次访问会自动完成 WebStock 设备配对。
7. 在 Safari 点“共享 -> 添加到主屏幕”，打开“作为网页 App 打开”，再点“添加”。

以后直接点击 iPhone 主屏幕上的 WebStock 图标即可。Windows WebStock 和 Tailscale 需要保持运行。

## 离线快照

- 每次成功读取后，iPhone 会把最近移动快照保存在 WebStock 网页 App 自己的 IndexedDB 中。
- Windows 电脑关机、Tailscale 断开或网络暂时不可用时，应用显示最近一次快照及保存时间。
- 离线数据不会标成实时行情，昨收数据也会继续显示“最近收盘行情”等来源状态。
- 离线快照只支持查看，不支持交易或修改 Windows 数据。

## 通知

iOS 16.4 或更高版本支持主屏幕网页 App 通知。添加到主屏幕后，点击“开启重要变化通知”并允许通知：

- 研究资料数量增加时提醒。
- 账户数量、持仓数量改变，或账户总资产相对上次检查变化达到 3% 时提醒。
- 普通价格小幅波动不提醒。
- 锁屏通知不包含账户名称、股票代码、持仓或金额。

Windows 每 5 分钟检查一次汇总变化。系统网络、休眠和苹果推送服务可能导致通知延迟；这不是交易级实时告警。

## 安全边界

- iPhone HTTPS 固定使用 Tailscale Serve 的 `8443` 端口，避免占用默认的其他服务。
- 服务只在同一 Tailscale 私网内可见，不使用 Tailscale Funnel，也不开放公网端口。
- Tailscale 身份验证之外，WebStock 仍要求一次性完整配对地址，并换取 `HttpOnly`、`SameSite=Strict`、`Secure` Cookie。
- 推送订阅和 VAPID 私钥只保存在 Windows WebStock 数据目录，不写入仓库。
- iPhone 页面不提供券商连接或真实订单提交。

## 常见状态

- `未安装`：Windows 没有检测到 Tailscale，点击安装按钮。
- `待登录`：Tailscale 已安装，但电脑尚未登录或离线。
- `已连接`：电脑已进入 Tailscale 私网，可以启用 iPhone HTTPS。
- `已启用`：安装地址已经生成，可以在 iPhone Safari 使用。
- `离线快照`：手机当前无法连接 Windows，页面正在显示最近保存的数据。

官方参考：[Apple 添加网页 App](https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios)、[Tailscale iOS 安装](https://tailscale.com/docs/install/ios)、[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)。
