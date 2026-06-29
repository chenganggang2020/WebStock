# Level-2 数据源接入说明

WebStock 现在支持通过授权 Level-2 HTTP 网关接入十档盘口、逐笔成交，并在本地计算大单统计。

## 可以接入的数据源

优先使用以下合规授权路径：

- 同花顺 DataFeed / iFinD 专业数据接口。
- 券商提供的 QMT、PTrade 等本地网关，前提是券商账号开通逐笔成交和盘口权限。
- 你自己封装的本地 HTTP 适配器，用来包装已授权 SDK。

不要逆向普通同花顺客户端。个人版 Level-2 通常只是展示授权，不等于允许本地程序调用或转存。

## 购买后需要向供应商确认的字段

- 十档盘口：买一到买十、卖一到卖十的价格和数量。
- 逐笔成交：成交时间、成交价、成交量、成交额、买卖方向。
- 可选逐笔委托：委托时间、价格、数量、方向、委托编号。
- 成交量单位：股还是手。对应设置 `LEVEL2_VOLUME_UNIT=share` 或 `lot`。
- 请求频率限制、落库限制、是否允许本地分析和再分发。

## WebStock 配置

可以在软件的“设置 -> Level-2 接入”中填写，也可以用环境变量：

```env
LEVEL2_PROVIDER=tonghuashun-http
LEVEL2_LOGIN_URL=https://quantapi.10jqka.com.cn/
LEVEL2_BASE_URL=http://127.0.0.1:18180
LEVEL2_API_KEY=
LEVEL2_AUTH_HEADER=Authorization
LEVEL2_AUTH_PREFIX=Bearer
LEVEL2_DEPTH_ENDPOINT=/depth?code={code}
LEVEL2_TRADES_ENDPOINT=/trades?code={code}&limit={limit}
LEVEL2_ORDERS_ENDPOINT=/orders?code={code}&limit={limit}
LEVEL2_TIMEOUT_MS=5000
LEVEL2_LARGE_ORDER_THRESHOLD=500000
LEVEL2_VOLUME_UNIT=share
```

如果同花顺或券商给的是 Python、Java、C++ SDK，需要先写一个本地小网关，把 SDK 结果转成上面的 HTTP 接口。

## WebStock API

- `GET /api/level2/status`
- `GET /api/level2/depth?code=000001`
- `GET /api/level2/trades?code=000001&limit=200`
- `GET /api/level2/large-orders?code=000001&threshold=500000`
- `GET /api/level2/free-flow?code=000001`
- `POST /api/level2/manual-trades`

## 免费资金流模拟

`free-flow` 当前使用东方财富公开资金流统计，返回主力净额、超大单净额、大单净额、中单净额、小单净额等字段。它适合免费试用和智能选股因子，但不是交易所原始 Level-2 逐笔成交。

## 普通同花顺 Level-2 辅助模式

如果只有普通同花顺 Level-2 会员，可以从同花顺逐笔成交/成交明细表复制可见行，粘贴到 WebStock 的“设置 -> Level-2 接入 -> 同花顺普通 Level-2 粘贴模拟”。WebStock 会按成交价、成交量、买卖方向估算大单净额。

该模式只分析你粘贴进来的可见数据，不会自动登录同花顺，也不会读取同花顺客户端缓存。

## 大单统计口径

WebStock 按逐笔成交计算：

```text
单笔成交额 = 成交价 * 成交量
大单 = 单笔成交额 >= 阈值
大单净额 = 大单主动买入额 - 大单主动卖出额
大单占比 = 大单成交额 / 逐笔成交总额
```

如果供应商不返回主动买卖方向，WebStock 会把该笔成交标记为 `neutral`，此时大单净额参考价值会下降，只能看大单成交额和占比。
