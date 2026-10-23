"""Small, explicit PyTorch research baselines with matured-label training.

No model zoo weights, pickle files, future validation, or profitability claims.
Every refit starts from the same seed and uses only its eligible training window.
"""
import base64
import hashlib
import importlib.metadata
import json
import math
import numpy as np
import pandas as pd
import torch
from torch import nn
from learning_models import FEATURES, features
from worker import clean, table

OPERATIONS = {"lstm", "transformer", "gcn"}


class SequenceRegressor(nn.Module):
    def __init__(self, name, length):
        super().__init__()
        self.name = name
        if name == "lstm":
            self.encoder = nn.LSTM(len(FEATURES), 16, num_layers=1, batch_first=True)
        else:
            self.project = nn.Linear(len(FEATURES), 16)
            layer = nn.TransformerEncoderLayer(16, 2, dim_feedforward=32,
                dropout=0., activation="relu", batch_first=True, norm_first=False)
            self.encoder = nn.TransformerEncoder(layer, num_layers=1, enable_nested_tensor=False)
            positions = torch.arange(length, dtype=torch.float64).unsqueeze(1)
            frequencies = torch.exp(torch.arange(0, 16, 2, dtype=torch.float64)*(-math.log(10000.)/16))
            encoding = torch.zeros(length, 16, dtype=torch.float64)
            encoding[:, 0::2] = torch.sin(positions*frequencies)
            encoding[:, 1::2] = torch.cos(positions*frequencies)
            self.register_buffer("positions", encoding)
        self.head = nn.Linear(16, 1)

    def forward(self, x):
        if self.name == "lstm":
            encoded, _ = self.encoder(x)
        else:
            # All tokens belong to the trailing input window. There are no
            # future tokens or per-token future targets requiring a causal mask.
            encoded = self.encoder(self.project(x)+self.positions)
        return self.head(encoded[:, -1, :])


class GraphRegressor(nn.Module):
    def __init__(self, adjacency):
        super().__init__()
        self.register_buffer("adjacency", torch.as_tensor(adjacency, dtype=torch.float64))
        self.first = nn.Linear(len(FEATURES), 16)
        self.second = nn.Linear(16, 1)

    def forward(self, x):
        h = torch.relu(self.first(self.adjacency @ x))
        return self.second(self.adjacency @ h).squeeze(-1)


def graph_from_training(returns, threshold):
    centered = returns-returns.mean(axis=0)
    cross = centered.T @ centered
    denom = np.sqrt(np.outer(np.diag(cross), np.diag(cross)))
    correlation = np.divide(cross, denom, out=np.zeros_like(cross), where=denom > 0)
    correlation = np.clip(correlation, -1., 1.)
    # Positive correlation edges only. An isolated/constant node keeps its own
    # self-loop; undefined correlations do not become invented relationships.
    weights = np.where((correlation >= threshold) & (correlation > 0), correlation, 0.)
    np.fill_diagonal(weights, 1.)
    degree = weights.sum(axis=1)
    normalized = weights/np.sqrt(np.outer(degree, degree))
    return normalized, correlation


def prepare(name, b, p):
    if name != "gcn":
        return b.time.to_numpy(), ["single-series"], features(b).to_numpy()[:, None, :], b.close.to_numpy()[:, None]
    symbols = [x.strip() for x in p["symbols"].split(",")]
    if not 2 <= len(symbols) <= 16 or len(set(symbols)) != len(symbols) or any(not x or len(x)>64 for x in symbols):
        raise ValueError("Specify 2..16 distinct, ex-ante research securities")
    times = pd.Index(sorted(b.time.unique()))
    arrays = []; prices = []
    for symbol in symbols:
        s = b[b.symbol == symbol].set_index("time").reindex(times)
        if s[["open", "high", "low", "close", "volume"]].isna().any().any():
            raise ValueError("Every decision requires all selected synchronized securities; no forward fill")
        arrays.append(features(s).to_numpy()); prices.append(s.close.to_numpy())
    return times.to_numpy(), symbols, np.stack(arrays, axis=1), np.stack(prices, axis=1)


def model_state(model):
    return {key: value.detach().cpu().tolist() for key, value in model.state_dict().items()}


def state_digest(value):
    raw = json.dumps(clean(value), sort_keys=True, allow_nan=False, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def fit(name, x, y, p, adjacency=None):
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    torch.manual_seed(p["seed"])
    mean = x.reshape(-1, len(FEATURES)).mean(axis=0)
    scale = x.reshape(-1, len(FEATURES)).std(axis=0, ddof=0)
    scale[scale == 0] = 1.
    target_mean = y.mean(axis=0); target_scale = y.std(axis=0, ddof=0)
    target_scale[target_scale == 0] = 1.
    z = torch.as_tensor((x-mean)/scale, dtype=torch.float64)
    target = torch.as_tensor((y-target_mean)/target_scale, dtype=torch.float64)
    model = (GraphRegressor(adjacency) if name == "gcn" else SequenceRegressor(name, p["sequenceRows"])).double()
    initial = state_digest(model_state(model))
    optimizer = torch.optim.Adam(model.parameters(), lr=p["learningRate"], weight_decay=0., foreach=False)
    model.train(); losses = []
    for epoch in range(p["epochs"]):
        optimizer.zero_grad(set_to_none=True)
        loss = torch.mean((model(z)-target)**2)
        if not torch.isfinite(loss):raise ValueError("Nonfinite training loss")
        loss.backward()
        norm = nn.utils.clip_grad_norm_(model.parameters(), max_norm=1., error_if_nonfinite=True)
        optimizer.step()
        losses.append((epoch+1, float(loss.detach()), float(norm)))
    model.eval()
    with torch.no_grad():
        final_loss = float(torch.mean((model(z)-target)**2))
    if not math.isfinite(final_loss):raise ValueError("Nonfinite final training loss")
    return model, mean, scale, target_mean, target_scale, losses, initial, final_loss


def calculate(name, b, p):
    if name not in OPERATIONS:raise ValueError("Unknown deep model")
    times, symbols, raw_features, prices = prepare(name, b, p)
    n, nodes = prices.shape
    h, gap, window, step = p["horizon"], p["purgeBars"], p["trainingRows"], p["retrainEvery"]
    length = 1 if name == "gcn" else p["sequenceRows"]
    # Bound workload, memory and result rows before building training tensors.
    if n*nodes > 100000 or window*length*nodes > 500000:
        raise ValueError("Deep model workload exceeds bounded research input size")
    if max(0, n-window-h-gap)//step+1 > 200:
        raise ValueError("More than 200 possible refits; increase retrainEvery")
    targets = np.full_like(prices, np.nan)
    if h < n:targets[:-h] = prices[h:]/prices[:-h]-1
    finite = np.isfinite(raw_features).all(axis=(1, 2))
    valid_features = pd.Series(finite.astype(int)).rolling(length).sum().eq(length).to_numpy()
    eligible = np.flatnonzero(valid_features & np.isfinite(targets).all(axis=1))
    rows = []; audit = []; preprocessing = []; training = []; evaluations = []; edges = []
    predictions = {}; last_fit = -step; fit_id = 0; last_state = None
    cumulative = np.zeros(nodes); cumulative_base = np.zeros(nodes); evaluated = 0
    def inputs(indices):
        if name == "gcn":return raw_features[indices]
        return raw_features[indices[:, None]-np.arange(length-1, -1, -1)[None, :], 0, :]
    for i in range(n):
        origin = i-h
        if origin in predictions:
            old, baseline = predictions[origin]; actual = targets[origin]; evaluated += 1
            cumulative += (old-actual)**2; cumulative_base += (baseline-actual)**2
            for k, symbol in enumerate(symbols):
                evaluations.append({"time":times[i], "symbol":symbol, "predictionTime":times[origin],
                    "predictionBar":origin, "outcomeBar":i, "actual":actual[k], "prediction":old[k],
                    "trainingBaseline":baseline[k], "evaluatedPredictions":evaluated,
                    "cumulativeMse":cumulative[k]/evaluated, "baselineMse":cumulative_base[k]/evaluated,
                    "mseSkillVsTrainingBaseline":1-cumulative[k]/cumulative_base[k] if cumulative_base[k]>0 else np.nan})
        count = int(np.searchsorted(eligible, i-h-gap, side="right"))
        if not valid_features[i] or count < window:continue
        if not fit_id or i-last_fit >= step:
            train = eligible[count-window:count]
            adjacency = correlation = None
            if name == "gcn":
                adjacency, correlation = graph_from_training(raw_features[train, :, 0], p["edgeThreshold"])
            model, mean, scale, ymean, yscale, losses, initial, final_loss = fit(name, inputs(train), targets[train], p, adjacency)
            fit_id += 1; last_fit = i
            last_state = {"schema":"webstock.deep-model.v1", "operation":name, "trainedAt":str(times[i]),
                "architecture":"gcn-7-16-1" if name == "gcn" else ("lstm-7-16-1" if name == "lstm" else "transformer-7-16-heads2-ff32-layer1"),
                "features":FEATURES, "symbols":symbols, "parameters":p, "stateDict":model_state(model),
                "featureMean":mean.tolist(), "featureScale":scale.tolist(), "targetMean":ymean.tolist(), "targetScale":yscale.tolist(),
                "firstFeatureBar":int(train[0]-length+1), "lastFeatureBar":int(train[-1]),
                "lastOutcomeBar":int(train[-1]+h), "target":"future-close-simple-return", "horizon":h}
            audit.append({"time":times[i], "fitId":fit_id, "predictionBar":i, "trainingRows":window,
                "firstSequenceBar":int(train[0]-length+1), "firstFeatureEndBar":int(train[0]),
                "lastFeatureBar":int(train[-1]), "lastOutcomeBar":int(train[-1]+h), "purgeBars":gap,
                "initialWeightsSha256":initial, "finalWeightsSha256":state_digest(model_state(model)),
                "stateSha256":state_digest(last_state), "finalTrainingMseStandardized":final_loss})
            for epoch, loss, norm in losses:
                training.append({"time":times[i], "fitId":fit_id, "epoch":epoch,
                    "preUpdateTrainingMseStandardized":loss, "preClipGradientNorm":norm})
            for k, feature in enumerate(FEATURES):
                preprocessing.append({"time":times[i], "fitId":fit_id, "feature":feature, "mean":mean[k], "scale":scale[k]})
            if name == "gcn":
                for a, source in enumerate(symbols):
                    for c, destination in enumerate(symbols):
                        edges.append({"time":times[i], "fitId":fit_id, "source":source, "destination":destination,
                            "trainingCorrelation":correlation[a, c], "normalizedWeight":adjacency[a, c],
                            "graphLastReturnBar":int(train[-1])})
        with torch.no_grad():
            predicted = model(torch.as_tensor((inputs(np.array([i]))-mean)/scale, dtype=torch.float64)).numpy()[0]*yscale+ymean
        if not np.isfinite(predicted).all():raise ValueError("Nonfinite deep model prediction")
        predictions[i] = predicted.copy(), ymean.copy()
        for k, symbol in enumerate(symbols):
            rows.append({"time":times[i], "symbol":symbol, "prediction":predicted[k], "trainingBaseline":ymean[k],
                "fitId":fit_id, "predictionBar":i, "trainLastOutcomeBar":int(train[-1]+h)})
    if not audit:raise ValueError("Not enough mature labels and valid trailing features")
    last_state["dependencies"] = {key:importlib.metadata.version(key) for key in ("torch", "numpy", "pandas")}
    raw = json.dumps(clean(last_state), ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(",", ":")).encode()
    if len(raw)>16*1024*1024:raise ValueError("Deep model state exceeds export limit")
    evaluation_columns = ["time", "symbol", "predictionTime", "predictionBar", "outcomeBar", "actual", "prediction", "trainingBaseline",
        "evaluatedPredictions", "cumulativeMse", "baselineMse", "mseSkillVsTrainingBaseline"]
    tables = [table("indicators", pd.DataFrame(rows)), table("training-audit", pd.DataFrame(audit)),
        table("training-preprocessing", pd.DataFrame(preprocessing)), table("training-loss", pd.DataFrame(training)),
        table("matured-evaluation", pd.DataFrame(evaluations, columns=evaluation_columns))]
    if edges:tables.append(table("training-graph", pd.DataFrame(edges)))
    notes = ["PyTorch CPU固定小模型基线，逐时点从固定随机种子重新训练；训练标签成熟后再留出隔离根数。",
        "均值与标准差只从当次训练输入及标签计算。序列标准化按训练序列中各时间片出现次数加权；图模型按训练时间与节点合并计算特征标准化。",
        "固定轮数、全批Adam、梯度范数裁剪1；没有未来早停、随机验证切分或全样本调参。训练损失下降不等于样本外有效。",
        "预测为随后H根收盘简单收益，结果在到期时才评价；重叠标签使误差相关。不含交易执行、费用或策略权益。",
        "JSON导出最后模型权重、标准化与架构参数；不用可执行pickle，不自动执行外部导入模型。不同硬件/库版本不承诺逐位一致。"]
    if name == "gcn":notes.append("图采用训练样本中的正收益相关权重与自环，D^-1/2 A D^-1/2两层传播。证券列表由用户事先指定，不从未来全样本推断；研究集合不能视为无幸存者偏差的可交易股票池。")
    if "datasetkind" in b and b.datasetkind.eq("synthetic-test").any():notes.insert(0,"合成验算数据，不是实盘收益证据。")
    return {"kind":"indicator", "engineVersion":"pytorch-"+torch.__version__, "formulaVersion":"webstock-deep-"+name+"-v1",
        "tables":tables, "warnings":notes, "generatedData":{"name":name+"-last-fit.json", "mediaType":"application/json",
            "sha256":hashlib.sha256(raw).hexdigest(), "base64":base64.b64encode(raw).decode()},
        "modelSemantics":{"fits":fit_id, "nodes":nodes, "targetHorizon":h, "cpuOnly":True,
            "trainingUsesFutureLabels":False, "graphUsesFutureReturns":False, "fixedEpochs":p["epochs"], "executionIncluded":False}}
