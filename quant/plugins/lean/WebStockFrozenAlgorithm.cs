// WebStock adapter: original LEAN algorithm, portfolio, orders and fill model.
// No brokerage credentials, cloud jobs or live-mode support.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using QuantConnect;
using QuantConnect.Algorithm;
using QuantConnect.Configuration;
using QuantConnect.Data;
using QuantConnect.Indicators;
using QuantConnect.Orders;
using QuantConnect.Orders.Fees;
using QuantConnect.Securities;
using NodaTime;

public class WebStockFrozenAlgorithm : QCAlgorithm
{
    private Symbol _symbol;
    private SimpleMovingAverage _fast, _slow;
    private decimal _previousFast, _previousSlow, _quantity;
    private bool _ready;
    private int _pending;
    private string _signalDay = "", _barDay = "";
    private readonly List<object[]> _equity = new(), _orders = new(), _signals = new();

    public override void Initialize()
    {
        SetTimeZone(DateTimeZone.Utc);
        SetStartDate(DateTime.ParseExact(GetParameter("start"), "yyyy-MM-dd", CultureInfo.InvariantCulture));
        SetEndDate(DateTime.ParseExact(GetParameter("end"), "yyyy-MM-dd", CultureInfo.InvariantCulture).AddDays(1));
        SetCash(GetParameter("capital", 100000m));
        SetBenchmark(t => 1m);
        var properties = new SymbolProperties("Frozen CSV", "USD", 1m, 0.000001m, 1m, "WSFROZEN");
        var security = AddData<WebStockFrozenBar>("WSFROZEN", properties, SecurityExchangeHours.AlwaysOpen(DateTimeZone.Utc), Resolution.Daily, false, 1m);
        _symbol = security.Symbol;
        security.SetFeeModel(new WebStockNotionalFee(GetParameter("feeBps", 5m) / 10000m));
        _quantity = GetParameter("quantity", 100m);
        _fast = new SimpleMovingAverage(GetParameter("fast", 10));
        _slow = new SimpleMovingAverage(GetParameter("slow", 30));
    }

    public override void OnData(Slice slice)
    {
        if (!slice.Get<WebStockFrozenBar>().TryGetValue(_symbol, out var bar)) return;
        if (bar.IsFillForward) throw new InvalidOperationException("Unexpected fill-forward input");
        _barDay = bar.Time.ToString("yyyy-MM-dd");
        // The signal was formed from the preceding completed input bar. Orders
        // are deliberately submitted at this bar's close, using LEAN's model.
        if (_pending > 0 && Portfolio[_symbol].Quantity == 0)
            MarketOrder(_symbol, _quantity, false, "signal:" + _signalDay);
        if (_pending < 0 && Portfolio[_symbol].Quantity > 0)
            MarketOrder(_symbol, -Portfolio[_symbol].Quantity, false, "signal:" + _signalDay);
        _pending = 0;
        _fast.Update(bar.EndTime, bar.Value); _slow.Update(bar.EndTime, bar.Value);
        if (_fast.IsReady && _slow.IsReady)
        {
            if (_ready && _previousFast <= _previousSlow && _fast.Current.Value > _slow.Current.Value) _pending = 1;
            if (_ready && _previousFast >= _previousSlow && _fast.Current.Value < _slow.Current.Value) _pending = -1;
            _previousFast = _fast.Current.Value; _previousSlow = _slow.Current.Value; _ready = true;
        }
        _signalDay = _barDay;
        if (_pending != 0) _signals.Add(new object[] { _barDay, Time.ToString("o"), _pending, _fast.Current.Value, _slow.Current.Value });
        _equity.Add(new object[] { _barDay, Time.ToString("o"), Portfolio.TotalPortfolioValue, Portfolio.Cash, Portfolio[_symbol].Quantity, bar.Value });
    }

    public override void OnOrderEvent(OrderEvent e)
    {
        var order = Transactions.GetOrderById(e.OrderId);
        _orders.Add(new object[] { _barDay, e.UtcTime.ToString("o"), e.OrderId, e.Status.ToString(), e.FillQuantity, e.FillPrice,
            e.OrderFee.Value.Amount, e.OrderFee.Value.Currency, order?.Tag ?? "", e.Message ?? "" });
    }

    public override void OnEndOfAlgorithm()
    {
        var result = new { engineVersion = typeof(QCAlgorithm).Assembly.GetName().Version.ToString(),
            equity = _equity, orders = _orders, signals = _signals };
        File.WriteAllText(GetParameter("adapterOutput"), JsonSerializer.Serialize(result));
    }
}

public class WebStockNotionalFee : FeeModel
{
    private readonly decimal _rate;
    public WebStockNotionalFee(decimal rate) { _rate = rate; }
    public override OrderFee GetOrderFee(OrderFeeParameters p) =>
        new OrderFee(new CashAmount(Math.Abs(p.Order.Quantity) * p.Security.Price * _rate, "USD"));
}

// Keep the original result handler and accounting, but do not run LEAN's
// optional post-run heuristic analyzer. Long historical fixtures can spend
// minutes there after all bars/orders and standard statistics are complete.
public class WebStockResultHandler : QuantConnect.Lean.Engine.Results.BacktestingResultHandler
{
    public WebStockResultHandler() { RunResultsAnalysis = false; }
}

public class WebStockFrozenBar : BaseData
{
    public override DateTime EndTime { get; set; }
    public override SubscriptionDataSource GetSource(SubscriptionDataConfig config, DateTime date, bool isLiveMode)
    {
        if (isLiveMode) throw new InvalidOperationException("Live mode is not supported");
        return new SubscriptionDataSource(Config.Get("webstock-input"), SubscriptionTransportMedium.LocalFile);
    }
    public override BaseData Reader(SubscriptionDataConfig config, string line, DateTime date, bool isLiveMode)
    {
        if (line.StartsWith("time,")) return null;
        var cells = line.Split(',');
        var time = DateTime.ParseExact(cells[0], "yyyy-MM-dd", CultureInfo.InvariantCulture);
        return new WebStockFrozenBar { Symbol = config.Symbol, Time = time, EndTime = time.AddDays(1),
            Value = decimal.Parse(cells[4], CultureInfo.InvariantCulture) };
    }
}
