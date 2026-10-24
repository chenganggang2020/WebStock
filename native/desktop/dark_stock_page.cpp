#include "dark_stock_page.hpp"
#include "trading_day_selection.hpp"
#include "financial_delegate.hpp"
#include "dark_stock.hpp"
#include "dark_stock_rank.hpp"
#include "dark_observation_page.hpp"
#include <QStackedWidget>
#include <QGuiApplication>
#include <QComboBox>
#include <QCheckBox>
#include <QCoreApplication>
#include <QDateEdit>
#include <QHeaderView>
#include <QHideEvent>
#include <QLabel>
#include <QLineEdit>
#include <QPointer>
#include <QPushButton>
#include <QRegularExpression>
#include <QTableWidget>
#include <QThreadPool>
#include <QTimeZone>
#include <QVBoxLayout>
namespace {
QString money(QJsonValue v) {
  return v.isString()
             ? QString::number(v.toString().toLongLong() / 1000000., 'f', 2)
             : "—";
}
QString local(QString s) {
  auto d = QDateTime::fromString(s, Qt::ISODateWithMs);
  return d.isValid() ? d.toTimeZone(QTimeZone::fromSecondsAheadOfUtc(28800))
                           .toString("yyyy-MM-dd HH:mm:ss")
                     : "未知";
}
template <class F> void deliver(QPointer<DarkStockPage> p, F callback) {
  QMetaObject::invokeMethod(
      QCoreApplication::instance(),
      [p, callback] {
        if (p)
          callback(p.data());
      },
      Qt::QueuedConnection);
}
} // namespace
DarkStockPage::DarkStockPage(QString dir, bool enabled, QWidget *parent)
    : QWidget(parent), directory(std::move(dir)), allowNetwork(enabled) {
  setObjectName("darkStockPage");
  auto *outer = new QVBoxLayout(this);
  outer->setContentsMargins(0, 0, 0, 0);
  stack = new QStackedWidget;
  outer->addWidget(stack);
  auto *main = new QWidget;
  stack->addWidget(main);
  observations = new DarkObservationPage(directory + ".observations-v1");
  stack->addWidget(observations);
  connect(observations, &DarkObservationPage::backRequested, this, [this] { closeObservation(); });
  connect(qGuiApp, &QGuiApplication::applicationStateChanged, this, [this](Qt::ApplicationState state) {
    if (state != Qt::ApplicationActive) { cancel(); observations->cancel(); }
  });
  auto *root = new QVBoxLayout(main);
  auto *tools = new QHBoxLayout;
  root->addLayout(tools);
  date = new QDateEdit(QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date());
  date->setDisplayFormat("yyyy-MM-dd");
  date->setCalendarPopup(true);
  date->setObjectName("darkStockDate");
  tools->addWidget(date);
  auto button = [&](QString title, QString name) {
    auto *b = new QPushButton(title);
    b->setObjectName(name);
    tools->addWidget(b);
    return b;
  };
  auto *read = button("重新载入", "darkStockRead");
  refresh = button("更新共享个股榜", "darkStockRefresh");
  refresh->setEnabled(allowNetwork);
  auto *stop = button("取消任务", "darkStockCancel");
  own = new QCheckBox("仅自选股票");
  own->setObjectName("darkStockOwn");
  own->setEnabled(false);
  tools->addWidget(own);
  search = new QLineEdit;
  search->setPlaceholderText("名称 / 市场代码");
  search->setObjectName("darkStockSearch");
  tools->addWidget(search, 1);
  auto *quote = button("打开所选行情", "darkStockQuote");
  auto *observe = button("观察历史", "darkStockObservations");
  connect(observe, &QPushButton::clicked, this, [this, observe] {
    if (!observe->isVisible() || window()->isMinimized() || QGuiApplication::applicationState() != Qt::ApplicationActive) return;
    cancel();
    int i = table->currentRow();
    auto selected = i >= 0 && i < displayed.size() ? displayed[i].toObject().value("key").toString() : QString();
    observations->openCaptured(snapshot, selected, date->date().toString(Qt::ISODate));
    stack->setCurrentWidget(observations);
  });
  auto *ranking = new QHBoxLayout;
  root->addLayout(ranking);
  ranking->addWidget(new QLabel("完整榜单"));
  rankMetric = new QComboBox;
  rankMetric->setObjectName("darkStockMetric");
  rankMetric->addItem("暗盘净额", "amount");
  rankMetric->addItem("明盘净额", "visible");
  rankMetric->addItem("合计净额", "combined");
  ranking->addWidget(rankMetric);
  rankDirection = new QComboBox;
  rankDirection->setObjectName("darkStockDirection");
  rankDirection->addItem("原始顺序", "source");
  rankDirection->addItem("正净额：从大到小", "inflow");
  rankDirection->addItem("负净额：从小到大", "outflow");
  ranking->addWidget(rankDirection);
  auto *rankNotice = new QLabel("按完整筛选结果排名再分页；多页非同步快照。缺失金额不参与正负榜；待核对行保留标识。");
  rankNotice->setWordWrap(true);
  ranking->addWidget(rankNotice, 1);
  state = new QLabel;
  state->setWordWrap(true);
  state->setObjectName("darkStockState");
  root->addWidget(state);
  auto *notice =
      new QLabel("东方财富明暗盘模型估算 · 万元 · "
                 "非交易所逐笔资金或ETF申赎。分页不是同一时刻；源时钟未知，抓取"
                 "时刻不代表实时。每次主动共享扫描最多60页/"
                 "6000项、45秒；成功冷却300秒，失败60秒。没有自动轮询。");
  notice->setWordWrap(true);
  root->addWidget(notice);
  table = new QTableWidget(0, 7);
  table->setObjectName("darkStockTable");
  financialVisual::install(table,{1,2,3});financialVisual::install(table,{4},false);
  table->setHorizontalHeaderLabels({"股票 / 市场", "暗盘净额 万", "明盘净额 万",
                                    "合计净额 万", "涨跌幅", "金额质量",
                                    "本行抓取时刻"});
  table->verticalHeader()->hide();
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);
  table->setSelectionMode(QAbstractItemView::SingleSelection);
  table->setSelectionBehavior(QAbstractItemView::SelectRows);
  table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  root->addWidget(table, 1);
  detail = new QLabel("选择一行查看来源与口径");
  detail->setObjectName("darkStockDetail");
  detail->setWordWrap(true);
  root->addWidget(detail);
  auto *footer = new QHBoxLayout;
  root->addLayout(footer);
  back = new QPushButton("上一页");
  back->setObjectName("darkStockPrevious");
  next = new QPushButton("下一页");
  next->setObjectName("darkStockNext");
  pages = new QLabel;
  footer->addWidget(back);
  footer->addWidget(pages, 1);
  footer->addWidget(next);
  connect(read, &QPushButton::clicked, this, [this, read] { if (read->isVisible()) load(); });
  connect(refresh, &QPushButton::clicked, this, &DarkStockPage::refreshSource);
  connect(stop, &QPushButton::clicked, this, [this] {
    cancel();
    resultState = "已取消未完成请求；已有缓存保留";
    render();
  });
  connect(date, &QDateEdit::dateChanged, this, [this] {
    snapshot = {};
    page = 0;
    load();
  });
  connect(search, &QLineEdit::textChanged, this, [this] {
    page = 0;
    render();
  });
  connect(own, &QCheckBox::toggled, this, [this] {
    page = 0;
    render();
  });
  auto rankChanged = [this] { page = 0; render(); };
  connect(rankMetric, &QComboBox::currentIndexChanged, this, rankChanged);
  connect(rankDirection, &QComboBox::currentIndexChanged, this, rankChanged);
  connect(back, &QPushButton::clicked, this, [this] {
    page = std::max(0, page - 1);
    render();
  });
  connect(next, &QPushButton::clicked, this, [this] {
    page++;
    render();
  });
  connect(table, &QTableWidget::itemSelectionChanged, this, [this] {
    int i = table->currentRow();
    if (i < 0 || i >= displayed.size())
      return;
    auto r = displayed[i].toObject();
    detail->setText(
        r["name"].toString() + " · " + r["key"].toString() + " · 本行抓取 " +
        local(r["receivedAt"].toString()) +
        "\n来源：东方财富 GrayMarketRank "
        "模型估算；源时刻未确认，非买卖建议；接口非文档化，许可未核验。");
  });
  connect(quote, &QPushButton::clicked, this, [this, quote] {
    if (!quote->isVisible() || window()->isMinimized() || QGuiApplication::applicationState() != Qt::ApplicationActive) return;
    int i = table->currentRow();
    if (i >= 0 && i < displayed.size()) {
      auto k = displayed[i].toObject()["key"].toString();
      if (QRegularExpression("^(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})$")
              .match(k)
              .hasMatch())
        emit stockRequested(k);
      else
        detail->setText("来源市场未确认或不是普通股票，不能猜测行情身份。");
    }
  });
  load();
}
DarkStockPage::~DarkStockPage() { cancel(); }
bool DarkStockPage::closeObservation() {
  if (!isVisible() || window()->isMinimized() || QGuiApplication::applicationState() != Qt::ApplicationActive || stack->currentWidget() != observations) return false;
  observations->cancel();
  stack->setCurrentIndex(0);
  return true;
}
void DarkStockPage::hideEvent(QHideEvent *event) {
  cancel();
  QWidget::hideEvent(event);
}
void DarkStockPage::setSymbols(const QStringList &values) {
  symbols.clear();
  for (auto s : values)
    if (QRegularExpression("^(sh6[0-9]{5}|sz[03][0-9]{5}|bj[489][0-9]{5})$")
            .match(s)
            .hasMatch() &&
        !symbols.contains(s))
      symbols.append(s);
  own->setEnabled(!symbols.isEmpty() && symbols.size() <= 200);
  own->setChecked(own->isEnabled());
  page = 0;
  render();
}
void DarkStockPage::cancel() {
  ++generation;
  cancelled->store(true);
  cancelled = std::make_shared<std::atomic_bool>(false);
  refresh->setEnabled(allowNetwork);
}
void DarkStockPage::load() { run(false); }
void DarkStockPage::refreshSource() {
  if (allowNetwork && isVisible() && stack->currentIndex() == 0 && !window()->isMinimized() && QGuiApplication::applicationState() == Qt::ApplicationActive)
    run(true);
}
void DarkStockPage::run(bool network) {
  cancel();
  auto token = generation;
  auto flag = cancelled;
  auto d = tradingDaySelection::effective(date->date()).toString(Qt::ISODate), dir = directory;
  resultState = network ? "正在共享扫描；切股票不重复请求" : "读取本机缓存…";
  render();
  refresh->setEnabled(allowNetwork && !network);
  QPointer<DarkStockPage> weak(this);
  QThreadPool::globalInstance()->start([weak, token, flag, d, dir, network] {
    QJsonObject data;
    QString error;
    try {
      darkStock::Store store(dir);
      data = network ? store.refresh(
                           d, [flag] { return flag->load(); },
                           [weak, token](int p, int total) {
                             deliver(weak, [token, p, total](DarkStockPage *v) {
                               if (token == v->generation)
                                 v->state->setText(
                                     QString("共享扫描 第%1页 / "
                                             "来源报%2项；未完成不保存半榜")
                                         .arg(p)
                                         .arg(total));
                             });
                           })
                     : store.read(d);
    } catch (const std::exception &e) {
      error = QString::fromUtf8(e.what());
      try {
        data = darkStock::Store(dir).read(d);
      } catch (...) {
      }
    }
    if(data.isEmpty()&&!flag->load())try{data=darkStock::Store(dir).latestOnOrBefore(d);}catch(const std::exception& e){error+="；旧记录不可用："+QString::fromUtf8(e.what());}
    deliver(weak, [token, data, error, network, d](DarkStockPage *p) {
      if (token != p->generation)
        return;
      p->snapshot = data;
      const auto actual=data["tradingDay"].toString();
      if(data.isEmpty())p->resultState="请求日期 "+d+" 尚无可用榜单；未显示为0，未标为成功。"+error;
      else if(actual!=d)p->resultState="请求日期 "+d+" 未更新；显示最近已保存 "+actual+"（历史，非今日实时）。"+error;
      else p->resultState=error.isEmpty()?(network?"共享榜单已保存 · "+actual:"已载入此前榜单 · "+actual):"未更新，保留 "+actual+" 原榜单："+error;
      p->refresh->setEnabled(p->allowNetwork);
      p->page = 0;
      p->render();
    });
  });
}
void DarkStockPage::render() {
  table->setRowCount(0);
  displayed = {};
  QJsonArray rows = snapshot.value("rows").toArray();
  int missing = 0;
  QString extra;
  // Store/read and fetch validated the snapshot off the GUI thread already.
  if (own->isChecked()) {
    QMap<QString, QJsonObject> by;
    for (auto v : rows)
      by.insert(v.toObject()["key"].toString(), v.toObject());
    rows = {};
    for (auto symbol : symbols) {
      if (by.contains(symbol))
        rows.append(by[symbol]);
      else
        missing++;
    }
  }
  QJsonArray filtered;
  auto q = search->text().trimmed();
  for (auto v : rows) {
    auto r = v.toObject();
    if (q.isEmpty() || r["name"].toString().contains(q, Qt::CaseInsensitive) ||
        r["key"].toString().contains(q, Qt::CaseInsensitive))
      filtered.append(r);
  }
  QJsonObject ranking;
  try {
    ranking = darkStockRank::apply(filtered, rankMetric->currentData().toString(),
                                  rankDirection->currentData().toString());
    filtered = ranking.value("rows").toArray();
  } catch (const std::exception &error) {
    state->setText("排名不可用；原缓存保留：" + QString::fromUtf8(error.what()));
    back->setEnabled(false); next->setEnabled(false);
    pages->clear(); detail->setText("没有生成替代排名");
    return;
  }
  page = std::min(page, std::max(0, (int(filtered.size()) - 1) / 100));
  for (int i = page * 100; i < std::min((page + 1) * 100, int(filtered.size()));
       i++) {
    auto r = filtered[i].toObject();
    displayed.append(r);
    int n = table->rowCount();
    table->insertRow(n);
    QString quality = r["reconciled"].isNull()   ? "字段缺失"
                      : r["reconciled"].toBool() ? "对账一致"
                                                 : "对账不符";
    QStringList values{
        r["name"].toString() + " · " + r["key"].toString(),
        money(r["darkNetCents"]),
        money(r["visibleNetCents"]),
        money(r["combinedNetCents"]),
        r["changeRatio"].isDouble()
            ? QString::number(r["changeRatio"].toDouble() * 100, 'f', 2) + "%"
            : "—",
        quality,
        local(r["receivedAt"].toString())};
    for (int col = 0; col < values.size(); col++) {
      auto *item = new QTableWidgetItem(values[col]);
      item->setToolTip(values[col]);
      table->setItem(n, col, item);
    }
  }
  if (table->rowCount())
    table->selectRow(0);
  else
    detail->setText("当前日期/范围无可用行；未匹配、空值不补零。");
  back->setEnabled(page > 0);
  next->setEnabled((page + 1) * 100 < filtered.size());
  pages->setText(QString("%1项 · 第%2/%3页 · 每页100；过滤不发网络请求")
                     .arg(filtered.size())
                     .arg(page + 1)
                     .arg(std::max(1, (int(filtered.size()) + 99) / 100)));
  QString summary =
      snapshot.isEmpty()
          ? "所选日期暂无榜单，请刷新或选择已发布日期"
          : QString("交易日 %1 · 原始覆盖 %2项/%3页 · 抓取 %4（非行情时刻） · "
                    "未匹配 %5")
                .arg(snapshot["tradingDay"].toString())
                .arg(snapshot["coverage"].toObject()["receivedRows"].toInt())
                .arg(snapshot["coverage"].toObject()["pages"].toInt())
                .arg(local(snapshot["receivedAt"].toString()))
                .arg(missing);
  if (!snapshot.isEmpty() &&
      QDateTime::fromString(snapshot["receivedAt"].toString(),
                            Qt::ISODateWithMs)
              .secsTo(QDateTime::currentDateTimeUtc()) >= 300)
    summary += " · 旧缓存";
  if (symbols.size() > 200)
    extra = "自选超过200只：当前显示全榜，请按名称/代码过滤；未静默截断";
  if (!snapshot.isEmpty())
    summary += QString("\n本地%1 · %2 · 筛选范围%3项 / 当前榜%4项 · 所选金额缺失%5项、零值%6项、范围对账待核%7项；多页非同步快照")
                   .arg(rankMetric->currentText(), rankDirection->currentText())
                   .arg(ranking.value("inputCount").toInt())
                   .arg(ranking.value("rankedCount").toInt())
                   .arg(ranking.value("missingMetricCount").toInt())
                   .arg(ranking.value("zeroMetricCount").toInt())
                   .arg(ranking.value("unreconciledCount").toInt());
  state->setText(resultState + "\n" + summary +
                 (extra.isEmpty() ? "" : "\n" + extra));
}
