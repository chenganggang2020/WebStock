"""Versioned structure and statistical features, emitted only when knowable.

No vendor script is copied. These are explicit mathematical definitions, not a
claim of matching every implementation carrying the same marketing name.
"""
import math
import numpy as np
import pandas as pd


OPERATIONS = {"confirmed-pivots", "zigzag-confirmed", "fibonacci-confirmed",
              "structure-events", "renko-close", "kalman-filter", "hurst-rs",
              "higuchi-dimension", "permutation-entropy", "fft-trailing"}


def pivots(b, left, right):
    """Strict extrema; ties reject the candidate. Rows are confirmation rows."""
    if left < 1 or right < 1:
        raise ValueError("Pivot left/right must both be positive")
    high, low = b.high.to_numpy(), b.low.to_numpy()
    result = np.full((len(b), 4), np.nan)
    for i in range(left + right, len(b)):
        j = i - right
        hs = np.r_[high[j-left:j], high[j+1:i+1]]
        ls = np.r_[low[j-left:j], low[j+1:i+1]]
        if (high[j] > hs).all(): result[i, :2] = high[j], j
        if (low[j] < ls).all(): result[i, 2:] = low[j], j
    return result


def zigzag(close, threshold):
    """Close-only percentage reversal, no unfinished endpoint or backfill."""
    if not 0 < threshold < 1: raise ValueError("ZigZag reversal must be between 0 and 100 percent")
    out = np.full((len(close), 3), np.nan)
    direction = 0
    high = low = float(close[0]); high_bar = low_bar = 0
    for i, value in enumerate(close[1:], 1):
        if direction >= 0 and value > high: high, high_bar = value, i
        if direction <= 0 and value < low: low, low_bar = value, i
        tolerance = 8*np.finfo(float).eps*max(abs(value),abs(high),abs(low))
        if direction <= 0 and value >= low * (1 + threshold) - tolerance:
            out[i] = -1, low, low_bar
            direction = 1; high, high_bar = value, i
        elif direction >= 0 and value <= high * (1 - threshold) + tolerance:
            out[i] = 1, high, high_bar
            direction = -1; low, low_bar = value, i
    return out


def rs_exponent(values):
    """OLS log(mean R/S) on log(scale); ddof=1, no finite-sample correction."""
    n = len(values); sizes = []; means = []
    scale = 8
    while scale <= n // 2:
        segments = values[:(n // scale) * scale].reshape(-1, scale)
        centered = segments - segments.mean(axis=1, keepdims=True)
        ranges = np.ptp(np.cumsum(centered, axis=1), axis=1)
        deviations = segments.std(axis=1, ddof=1)
        valid = (deviations > 0) & (ranges > 0)
        if valid.any():
            sizes.append(scale); means.append(np.mean(ranges[valid] / deviations[valid]))
        scale *= 2
    if len(sizes) < 3: return np.nan
    return float(np.polyfit(np.log(sizes), np.log(means), 1)[0])


def higuchi(values, maximum):
    n = len(values); lengths = []
    for k in range(1, maximum + 1):
        sublengths = []
        for m in range(k):
            x = values[m::k]; count = len(x) - 1
            if count:
                sublengths.append(np.abs(np.diff(x)).sum() * (n-1) / (count*k*k))
        lengths.append(np.mean(sublengths))
    if not np.all(np.asarray(lengths) > 0): return np.nan
    return float(np.polyfit(np.log(1 / np.arange(1, maximum+1)), np.log(lengths), 1)[0])


def ordinal_entropy(values, order, delay):
    size = len(values) - (order - 1) * delay
    if size <= 0: return np.nan, 0
    vectors = np.column_stack([values[j*delay:j*delay+size] for j in range(order)])
    # Equal values have no strict ordering; discard them rather than invent ranks.
    distinct = (np.diff(np.sort(vectors, axis=1), axis=1) != 0).all(axis=1)
    ranks = np.argsort(vectors[distinct], axis=1)
    if not len(ranks): return np.nan, 0
    counts = np.unique(ranks, axis=0, return_counts=True)[1]
    probs = counts / counts.sum()
    return float(-np.dot(probs, np.log(probs)) / math.lgamma(order+1)), len(ranks)


def calculate(name, b, p):
    out = pd.DataFrame({"time": b.time})
    c = b.close.to_numpy(dtype=float)
    warnings = ["只使用截至该行已完成K线；bar字段是输入内从0开始的位置，time是信号实际可知时点。"]
    if name == "confirmed-pivots":
        out[["confirmedHigh", "highBar", "confirmedLow", "lowBar"]] = pivots(b, int(p["left"]), int(p["right"]))
        warnings.append("严格大于/小于两侧所有值才确认，同价不确认；默认左右各2根为严格五根分形版本。")
    elif name in ("zigzag-confirmed", "fibonacci-confirmed"):
        events = zigzag(c, p["reversalPct"] / 100)
        if name == "zigzag-confirmed":
            out[["pivotKind", "pivotPrice", "pivotBar"]] = events
            warnings.append("收盘价百分比反转；+1为确认顶部，-1为确认底部；未确认末端不输出，等价极值取首次。")
        else:
            columns = ["anchorA", "anchorB", "anchorABar", "anchorBBar", "retracement236", "retracement382",
                       "retracement500", "retracement618", "retracement786", "extension1272", "extension1618"]
            values = np.full((len(b), len(columns)), np.nan); previous = None; active = None
            for i, event in enumerate(events):
                if np.isfinite(event[0]):
                    if previous is not None:
                        a, z = previous[1], event[1]; delta = z-a
                        active = [a, z, previous[2], event[2]] + [z-delta*r for r in (.236,.382,.5,.618,.786)] + [z+delta*r for r in (.272,.618)]
                    previous = event
                if active is not None: values[i] = active
            out[columns] = values
            warnings.append("锚点为最近两个已确认且相反的ZigZag收盘拐点；回撤=B-(B-A)*比例，扩展=B+(B-A)*(倍数-1)。")
            warnings.append("新锚点确认后只改变今后行；价格比例区域没有已验证的预测收益优势。")
    elif name == "structure-events":
        pv = pivots(b, int(p["left"]), int(p["right"]))
        columns = ["structureDirection", "bos", "choch", "brokenLevel", "brokenPivotBar", "fvgDirection", "fvgLow", "fvgHigh", "orderBlockBar", "orderBlockLow", "orderBlockHigh"]
        values = np.full((len(b), len(columns)), np.nan)
        h, l, o = (b[x].to_numpy() for x in ("high", "low", "open"))
        high = low = None; direction = 0
        for i in range(len(b)):
            if np.isfinite(pv[i,0]): high = (pv[i,0], pv[i,1])
            if np.isfinite(pv[i,2]): low = (pv[i,2], pv[i,3])
            values[i,[1,2,5]] = 0
            sign = 0; broken = None
            if high is not None and c[i] > high[0]: sign, broken, high = 1, high, None
            elif low is not None and c[i] < low[0]: sign, broken, low = -1, low, None
            if sign:
                values[i,2 if direction == -sign else 1] = sign
                values[i,3:5] = broken; direction = sign
                for j in range(i-1, max(-1,i-1-int(p["blockLookback"])), -1):
                    if (c[j]-o[j])*sign < 0:
                        values[i,8:11] = j,l[j],h[j]; break
            values[i,0] = direction
            if i >= 2:
                if l[i] > h[i-2] * (1+p["minGapPct"]/100): values[i,5:8] = 1,h[i-2],l[i]
                elif h[i] < l[i-2] * (1-p["minGapPct"]/100): values[i,5:8] = -1,h[i],l[i-2]
        out[columns] = values
        warnings.append("WebStock明确规则版：收盘越过未消耗的最新确认拐点触发一次；首次/同向为BOS，反向为CHoCH。")
        warnings.append("FVG为第1与第3根高低区间严格不重叠，无中间K线颜色要求；Order Block为突破前指定回看内最后一根反向K线的完整高低区间。")
        warnings.append("仅输出已确认事件，不回填、不延伸为有效挂单区，不推断机构订单或意图；不宣称复刻某厂商SMC脚本。")
    elif name == "renko-close":
        box = float(p["boxSize"])
        if box <= 0 or not np.isfinite(box): raise ValueError("Renko requires a positive fixed box size")
        values = np.full((len(b),4),np.nan); last = c[0]; direction = 0
        for i,value in enumerate(c):
            difference = (value-last)/box
            # A decimal grid boundary can round slightly below an integer.
            steps = math.floor(abs(difference)+8*np.finfo(float).eps*max(1.,abs(value/box),abs(last/box)))
            count = 0; opening = np.nan
            if direction == 0 or (difference*direction > 0 and steps >= 1):
                if steps:
                    direction = 1 if difference > 0 else -1
                    last += direction*steps*box; count = steps; opening = last-direction*box
            elif difference*direction < 0 and steps >= 2:
                direction *= -1; last += direction*steps*box; count = steps-1; opening = last-direction*box
            values[i] = last,direction,count,opening
        out[["syntheticClose","direction","newBrickCount","lastNewBrickOpen"]] = values
        warnings.append("固定绝对砖尺寸、仅收盘价、两砖反转，首根收盘为网格锚；每行保存此时最后一砖和新增砖数，不推测K线内部路径。")
        warnings.append("砖价为合成价格，不能用作真实成交价；不使用全样本ATR或最后价格重新调整历史砖尺寸。")
        warnings.append("边界比较仅允许约8倍机器精度的浮点舍入容差；不代表价格最小跳动单位。")
    elif name == "kalman-filter":
        trend = p["model"] == "local-linear-trend"
        if p["model"] not in ("local-level", "local-linear-trend"): raise ValueError("Unknown Kalman model")
        dim = 2 if trend else 1
        transition = np.array([[1.,1.],[0.,1.]]) if trend else np.ones((1,1))
        q = np.diag([p["levelVariance"],p["trendVariance"]] if trend else [p["levelVariance"]])
        noise = float(p["observationVariance"])
        if noise<=0 or p["initialVariance"]<=0 or (np.diag(q)<0).any(): raise ValueError("Invalid Kalman variance")
        x = np.zeros(dim); x[0] = np.log(c[0]); covariance = np.eye(dim)*p["initialVariance"]
        values = np.full((len(b),7), np.nan)
        for i,y in enumerate(np.log(c)):
            innovation = gain0 = np.nan
            if i:
                x = transition@x; covariance = transition@covariance@transition.T+q
                innovation = y-x[0]; gain = covariance[:,0]/(covariance[0,0]+noise)
                gain0 = gain[0]; x = x+gain*innovation
                adjustment = np.eye(dim); adjustment[:,0] -= gain
                covariance = adjustment@covariance@adjustment.T+noise*np.outer(gain,gain)
            next_covariance = transition@covariance@transition.T+q
            values[i] = x[0], x[1] if trend else 0, covariance[0,0], innovation, gain0, (transition@x)[0], next_covariance[0,0]+noise
        out[["filteredLogLevel","filteredLogSlope","levelVariance","innovation","levelGain","nextLogPrediction","nextObservationVariance"]] = values
        warnings.append("对数收盘价状态空间过滤，首根观测初始化水平、斜率0、协方差为指定初值；固定方差参数，Joseph协方差更新。")
        warnings.append("下一根预测只用当前及以前观测；没有全样本拟合或后向平滑。参数选择仍需独立样本验证。")
    elif name in ("hurst-rs", "higuchi-dimension", "permutation-entropy", "fft-trailing"):
        n = int(p["period"]); log_price = np.log(c)
        if name == "hurst-rs":
            if n < 64: raise ValueError("R/S requires a window of at least 64 returns")
            out["hurstRS"] = pd.Series(log_price).diff().rolling(n).apply(rs_exponent, raw=True)
            warnings.append("对数收益的未校正R/S：从8到n/2的二次幂分段，分段样本标准差，平均R/S后做对数OLS；至少3个尺度，尾部余数舍弃。")
            warnings.append("有限样本偏差明显，数值不裁剪到0至1，不能将H>0.5解释为可盈利趋势。")
        elif name == "higuchi-dimension":
            k = int(p["maximumScale"])
            if k < 2 or n < 2*k+1: raise ValueError("Higuchi requires period >= 2*maximumScale+1")
            out["higuchiDimension"] = pd.Series(log_price).rolling(n).apply(lambda a:higuchi(a,k),raw=True)
            warnings.append("对数价格的Higuchi图形分维估计，尺度1至k，OLS log长度对log(1/k)；常量序列无定义留空，不裁剪估计值。")
        elif name == "permutation-entropy":
            order, delay = int(p["order"]), int(p["delay"])
            if not 2 <= order <= 6 or delay < 1 or n <= (order-1)*delay: raise ValueError("Invalid ordinal embedding")
            values = np.full((len(b),2),np.nan)
            for i in range(n-1,len(b)): values[i] = ordinal_entropy(log_price[i-n+1:i+1],order,delay)
            out[["normalizedEntropy","validPatterns"]] = values
            warnings.append("排列熵按log(order!)归一化，窗口内延迟嵌入；含同值的子序列舍弃，全部同值时无定义留空。")
        else:
            if n < 8: raise ValueError("FFT requires at least 8 observations")
            values = np.full((len(b),3),np.nan); t = np.arange(n)-(n-1)/2
            window = np.hanning(n)
            for i in range(n-1,len(b)):
                y = log_price[i-n+1:i+1]; centered = y-y.mean()
                residual = centered-t*np.dot(t,centered)/np.dot(t,t)
                if np.linalg.norm(residual) <= 1e-12*max(1.,np.linalg.norm(y)): continue
                power = np.abs(np.fft.rfft(residual*window))**2
                power[0]=0; power[1:len(power)-(n%2==0)] *= 2
                prob = power[1:]/power.sum(); k = int(np.argmax(power))
                positive = prob[prob>0]
                values[i] = n/k,power[k]/power.sum(),-np.dot(positive,np.log(positive))/np.log(len(prob))
            out[["dominantPeriodBars","peakPowerFraction","spectralEntropy"]] = values
            warnings.append("仅尾随窗口：对数价格线性去趋势、Hann窗、单边功率谱，除去DC；峰值周期以输入根数计，不代表固定日历周期。")
            warnings.append("只在窗口末端输出频谱摘要，不将全样本频谱或居中过滤回填到历史，不预测周期持续。")
    else:
        raise ValueError("Unknown temporal indicator")
    return out, warnings
